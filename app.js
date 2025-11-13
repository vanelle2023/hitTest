import * as THREE from 'three'; // <- SAUBER: "three" statt voller URL
import { ARButton } from 'three/addons/webxr/ARButton.js'; // <- SAUBER: "three/addons/..."
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; // <- SAUBER
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // <- SAUBER

let camera, scene, renderer, controls; // controls hinzugefügt
let controller;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let objectPlaced = false; 
let mapModel = null; // <- Variable für das 3D-Modell

init();
animate();

function init() {
  const container = document.createElement('div');
  document.body.appendChild(container);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xddeeff); // Hintergrundfarbe für Desktop

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
  camera.position.set(0, 1.5, 3); // Position für Desktop-Ansicht

  // --- Lichter ---
  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 5, 5);
  scene.add(dirLight);

  // --- Renderer ---
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);
  
  // --- OrbitControls für Desktop-Ansicht ---
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.update();

  // --- AR Button ---
  document.body.appendChild(
    ARButton.createButton(renderer, { 
        requiredFeatures: ['hit-test', 'local-floor'] // <- local-floor hinzugefügt
    })
  );
  
  // --- AR Session Event Listeners (WICHTIG) ---
  renderer.xr.addEventListener('sessionstart', () => {
    if (mapModel) mapModel.visible = false; // <- Modell bei AR-Start ausblenden
    objectPlaced = false; // Zurücksetzen für neue Platzierung
    hitTestSourceRequested = false; // HitTest-Quelle muss neu angefordert werden
    hitTestSource = null;
  });

  renderer.xr.addEventListener('sessionend', () => {
    if (mapModel) mapModel.visible = true; // <- Modell bei AR-Ende wieder anzeigen (Desktop)
    if (mapModel) mapModel.position.set(0, 0, 0); // <- Position zurücksetzen (optional)
  });


  // --- Controller und Reticle ---
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  const ringGeometry = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  reticle = new THREE.Mesh(ringGeometry, ringMaterial);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
  
  // --- GLTF Modell laden ---
  loadMapModel();

  window.addEventListener('resize', onWindowResize, false);
}

function loadMapModel() {
    const loader = new GLTFLoader();
    loader.load('mapBremerhaven2.glb', (gltf) => {
        mapModel = gltf.scene;
        
        // --- Skalierung und Centering ---
        const box = new THREE.Box3().setFromObject(mapModel);
        const size = box.getSize(new THREE.Vector3());
        
        // 1. UNSKALIERTE MAX-DIMENSION SPEICHERN
        mapModel.userData.originalMaxDim = Math.max(size.x, size.y, size.z); 
        
        const maxDim = mapModel.userData.originalMaxDim;

        // Skalierung für Desktop
        const scale = 1.0 / maxDim * 1.5; 
        mapModel.scale.setScalar(scale);

        const center = box.getCenter(new THREE.Vector3());
        mapModel.position.set(-center.x, 0, -center.z); // Zentriere am Boden

        // Setze das Modell für den Start als sichtbar (Desktop-Modus)
        mapModel.visible = true;
        scene.add(mapModel);
    }, undefined, (error) => {
        console.error('Fehler beim Laden des Modells:', error);
    });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onSelect() {
  if (!mapModel) return;

  if (reticle.visible && !objectPlaced) {
    
    // Setze Position und Rotation der MAP vom Reticle
    mapModel.position.setFromMatrixPosition(reticle.matrix);
    mapModel.quaternion.setFromRotationMatrix(reticle.matrix);
    
    // --- KORRIGIERTE SKALIERUNGSLOGIK ---
    const AR_TARGET_MAX_DIM = 0.5; // Zielgröße: Längste Kante soll 50 cm betragen
    
    // Lese die gespeicherte, unskalierte maximale Dimension
    const originalMaxDim = mapModel.userData.originalMaxDim || 1; // Fallback auf 1
    
    // AR Skalierung = (Gewünschte AR-Größe in Metern) / (Ursprüngliche Modellgröße in Einheiten)
    const finalARScale = AR_TARGET_MAX_DIM / originalMaxDim; 
    
    mapModel.scale.setScalar(finalARScale); 
    // ------------------------------------

    mapModel.visible = true; 
    
    // Nach Platzierung:
    objectPlaced = true;
    reticle.visible = false;
    hitTestSource = null; 
  }
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  controls.update(); // Für Desktop-Modus

  // Wenn bereits platziert ODER NICHT IM AR-MODUS, kein Hit-Test mehr
  if (!renderer.xr.isPresenting || objectPlaced) {
    renderer.render(scene, camera);
    return;
  }

  // --- HIT TEST LOGIK (NUR IM AR-MODUS UND WENN NOCH NICHT PLATZIERT) ---
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (hitTestSourceRequested === false) {
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
        const pose = hit.getPose(referenceSpace); // <- Verwendung von referenceSpace

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