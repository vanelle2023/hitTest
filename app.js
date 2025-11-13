import * as THREE from 'three'; // <- SAUBER: "three" statt voller URL
import { ARButton } from 'three/addons/webxr/ARButton.js'; // <- SAUBER: "three/addons/..."
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; // <- SAUBER
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // <- SAUBER

let camera, scene, renderer, controls;
let controller, reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let objectPlaced = false;
let mapModel = null;

init();
animate();

function init() {
  const container = document.createElement('div');
  document.body.appendChild(container);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xddeeff);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  // Licht
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 5, 5);
  scene.add(dirLight);

  // Controls (nur Desktop)
  controls = new OrbitControls(camera, renderer.domElement);
  camera.position.set(0, 1.5, 3);
  controls.update();

  // AR Button
  document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] }));

  // Controller + Reticle
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  const ringGeo = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  reticle = new THREE.Mesh(ringGeo, ringMat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // GLB Modell
  loadModel();

  // Session Events
  renderer.xr.addEventListener('sessionstart', () => {
    objectPlaced = false;
    reticle.visible = false;
    if (mapModel) mapModel.visible = false; // unsichtbar bis platziert
  });

  renderer.xr.addEventListener('sessionend', () => {
    if (mapModel) {
      mapModel.visible = true;
      mapModel.position.set(0, 0, 0);
      mapModel.scale.setScalar(1); // Reset
    }
  });

  window.addEventListener('resize', onWindowResize);
}

function loadModel() {
  const loader = new GLTFLoader();
  loader.load('./mapBremerhaven2.glb', (gltf) => {
    mapModel = gltf.scene;

    // Ursprüngliche Größe merken
    const box = new THREE.Box3().setFromObject(mapModel);
    const size = box.getSize(new THREE.Vector3());
    mapModel.userData.originalSize = Math.max(size.x, size.y, size.z);

    // Für Desktop leicht skalieren
    const scale = 1.0 / mapModel.userData.originalSize * 1.5;
    mapModel.scale.setScalar(scale);

    // Zentrieren
    const center = box.getCenter(new THREE.Vector3());
    mapModel.position.set(-center.x, -center.y, -center.z);

    scene.add(mapModel);
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onSelect() {
  if (!reticle.visible || !mapModel || objectPlaced) return;

  const originalSize = mapModel.userData.originalSize || 1;
  const targetSize = 0.5; // 50 cm max
  const scale = targetSize / originalSize;

  mapModel.position.setFromMatrixPosition(reticle.matrix);
  mapModel.quaternion.setFromRotationMatrix(reticle.matrix);
  mapModel.scale.setScalar(scale);
  mapModel.visible = true;

  objectPlaced = true;
  reticle.visible = false;
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  if (!renderer.xr.isPresenting) {
    controls.update();
    renderer.render(scene, camera);
    return;
  }

  const session = renderer.xr.getSession();
  const referenceSpace = renderer.xr.getReferenceSpace();

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

  if (frame && hitTestSource && !objectPlaced) {
    const hitTestResults = frame.getHitTestResults(hitTestSource);
    if (hitTestResults.length) {
      const hit = hitTestResults[0];
      const pose = hit.getPose(referenceSpace);
      if (pose) {
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
      }
    } else {
      reticle.visible = false;
    }
  }

  renderer.render(scene, camera);
}
