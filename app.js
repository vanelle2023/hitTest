import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let camera, scene, renderer, controls;
let controller;
let reticle;
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
  camera.position.set(0, 1.5, 3);

  // Lichter
  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);
  
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 5, 5);
  scene.add(dirLight);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);
  
  // OrbitControls für Desktop
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.update();

  // AR Button
  document.body.appendChild(
    ARButton.createButton(renderer, { 
      requiredFeatures: ['hit-test', 'local-floor']
    })
  );
  
  // AR Session Events
  renderer.xr.addEventListener('sessionstart', () => {
    if (mapModel) mapModel.visible = false;
    objectPlaced = false;
    hitTestSourceRequested = false;
    hitTestSource = null;
  });

  renderer.xr.addEventListener('sessionend', () => {
    if (mapModel) {
      mapModel.visible = true;
      // Setze Desktop-Position und -Skalierung zurück
      setupDesktopView();
    }
  });

  // Controller und Reticle
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  const ringGeometry = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  reticle = new THREE.Mesh(ringGeometry, ringMaterial);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
  
  // Modell laden
  loadMapModel();

  window.addEventListener('resize', onWindowResize, false);
}

function loadMapModel() {
  const loader = new GLTFLoader();
  loader.load('mapBremerhaven2.glb', (gltf) => {
    mapModel = gltf.scene;
    
    // WICHTIG: Erst Bounding Box vom UNSKALIERTEN Modell berechnen
    const box = new THREE.Box3().setFromObject(mapModel);
    const size = box.getSize(new THREE.Vector3());
    
    // Speichere die ORIGINALE maximale Dimension (unskaliert)
    mapModel.userData.originalMaxDim = Math.max(size.x, size.y, size.z);
    
    // Speichere auch das Zentrum des unskalierten Modells
    mapModel.userData.originalCenter = box.getCenter(new THREE.Vector3());
    
    scene.add(mapModel);
    
    // Setze Desktop-Ansicht
    setupDesktopView();
    
    mapModel.visible = true;
    
  }, undefined, (error) => {
    console.error('Fehler beim Laden des Modells:', error);
  });
}

function setupDesktopView() {
  if (!mapModel) return;
  
  const originalMaxDim = mapModel.userData.originalMaxDim || 1;
  const originalCenter = mapModel.userData.originalCenter || new THREE.Vector3();
  
  // Desktop-Skalierung: Modell soll ca. 2 Einheiten groß sein
  const desktopScale = 2.0 / originalMaxDim;
  mapModel.scale.setScalar(desktopScale);
  
  // Zentriere das Modell am Ursprung (berücksichtige die Skalierung)
  mapModel.position.set(
    -originalCenter.x * desktopScale,
    -originalCenter.y * desktopScale, 
    -originalCenter.z * desktopScale
  );
  
  // Kamera und Controls auf das Modell ausrichten
  controls.target.set(0, 0, 0);
  controls.update();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onSelect() {
  if (!mapModel || !reticle.visible || objectPlaced) return;

  // Setze Position vom Reticle
  mapModel.position.setFromMatrixPosition(reticle.matrix);
  mapModel.quaternion.setFromRotationMatrix(reticle.matrix);
  
  // AR-Skalierung: Modell soll 30cm groß sein (angepasst von 50cm)
  const AR_TARGET_SIZE = 0.3; // 30 cm
  const originalMaxDim = mapModel.userData.originalMaxDim || 1;
  const arScale = AR_TARGET_SIZE / originalMaxDim;
  
  mapModel.scale.setScalar(arScale);
  mapModel.visible = true;
  
  objectPlaced = true;
  reticle.visible = false;
  hitTestSource = null;
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  // Desktop Controls
  if (!renderer.xr.isPresenting) {
    controls.update();
  }

  // Wenn platziert oder nicht im AR-Modus, nur rendern
  if (!renderer.xr.isPresenting || objectPlaced) {
    renderer.render(scene, camera);
    return;
  }

  // Hit-Test Logik (nur im AR und vor Platzierung)
  if (frame) {
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

        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
        } else {
          reticle.visible = false;
        }
      } else {
        reticle.visible = false;
      }
    }
  }

  renderer.render(scene, camera);
}