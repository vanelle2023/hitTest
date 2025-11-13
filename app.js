import * as THREE from 'https://unpkg.com/three@0.158.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.158.0/examples/jsm/loaders/GLTFLoader.js';
import { ARButton } from 'https://unpkg.com/three@0.158.0/examples/jsm/webxr/ARButton.js';

let camera, scene, renderer;
let reticle, controller;
let hitTestSource = null;
let hitTestSourceRequested = false;
let model, modelPlaced = false;

init();
animate();

function init() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1.2);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  // 🔹 AR Button hinzufügen
  document.body.appendChild(
    ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] })
  );

  // 🔹 Reticle (grüner Kreis)
  const ringGeo = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  reticle = new THREE.Mesh(ringGeo, ringMat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // 🔹 Controller (Tap/Select)
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  // 🔹 Modell laden
  const loader = new GLTFLoader();
  loader.load(
    'mapBremerhaven2.glb', 
    (gltf) => {
      model = gltf.scene;
      model.scale.setScalar(0.2);
      model.position.set(0, 0, -1.2);
      scene.add(model); // Anzeige im normalen Modus
    },
    undefined,
    (error) => console.error('Fehler beim Laden:', error)
  );

  window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// 🔹 Nur 1× platzieren
function onSelect() {
  if (reticle.visible && model && !modelPlaced) {
    const clone = model.clone(true);
    clone.position.setFromMatrixPosition(reticle.matrix);
    clone.quaternion.setFromRotationMatrix(reticle.matrix);
    clone.scale.setScalar(0.2);
    scene.add(clone);
    modelPlaced = true;
    reticle.visible = false;
  }
}

function animate() {
  renderer.setAnimationLoop(render);
}

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
