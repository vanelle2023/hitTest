import * as THREE from 'three';
import { GLTFLoader } from 'https://unpkg.com/three@0.158.0/examples/jsm/loaders/GLTFLoader.js';
import { ARButton } from 'https://unpkg.com/three@0.158.0/examples/jsm/webxr/ARButton.js';

let scene, camera, renderer;
let reticle, controller;
let hitTestSource = null;
let hitTestSourceRequested = false;
let model = null;
let modelPlaced = false; // Nur einmal platzieren erlaubt

init();
animate();

function init() {
  const container = document.getElementById('container');

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1.2);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  // --- AR Button aktivieren ---
  document.body.appendChild(
    ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] })
  );

  // --- Reticle (Kreis) ---
  const ringGeo = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  reticle = new THREE.Mesh(ringGeo, ringMat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // --- Controller für Klick/Select ---
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  // --- GLTF Modell laden ---
  const loader = new GLTFLoader();
  loader.load(
    'mapBremerhaven.glb',
    (gltf) => {
      model = gltf.scene;
      model.scale.setScalar(0.2); // 🔹 kleiner für AR
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Im normalen Browser anzeigen (nicht AR)
      scene.add(model);
      model.position.set(0, 0, -1.2);
    },
    undefined,
    (error) => console.error('Fehler beim Laden von mapBremerhaven.glb:', error)
  );

  window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Objekt in AR platzieren ---
function onSelect() {
  if (reticle.visible && model && !modelPlaced) {
    const clone = model.clone(true);
    clone.position.setFromMatrixPosition(reticle.matrix);
    clone.quaternion.setFromRotationMatrix(reticle.matrix);
    clone.scale.setScalar(0.2); // 🔹 etwas kleiner in AR
    scene.add(clone);

    modelPlaced = true;
    reticle.visible = false;
    hitTestSource = null;
  }
}

// --- Render-Schleife ---
function animate() {
  renderer.setAnimationLoop(render);
}

// --- Rendering & AR Hit Test ---
function render(timestamp, frame) {
  if (frame && !modelPlaced) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace('viewer').then((refSpace) => {
        session.requestHitTestSource({ space: refSpace }).then((source) => {
          hitTestSource = source;
        });
      });

      session.addEventListener('end', () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });

      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(referenceSpace);

        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
      } else {
        reticle.visible = false;
      }
    }
  }

  renderer.render(scene, camera);
}
