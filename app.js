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
let activeMarker = null; // NUR EIN Marker!
let character = null;
let dayLight, nightLight, moonLight;
let raycaster, mouse;
let isDayMode = true;
let currentPOIIndex = 0; // Aktuelle Tour-Station
let visitedPOIs = new Set();

// POIs für Bremerhaven
const pointsOfInterest = [
  { id: 1, name: 'Klimahaus Bremerhaven', blenderName: 'Klimahaus_Bremerhaven', description: 'Erlebnismuseum der Klimazonen', icon: '🌍' },
  { id: 2, name: 'Radarturm', blenderName: 'Radarturm', description: 'Historischer Radarturm', icon: '📡' },
  { id: 3, name: 'Alter Hafen', blenderName: 'Alter_Hafen', description: 'Traditioneller Hafen', icon: '⚓' },
  { id: 4, name: 'Historisches Museum', blenderName: 'Historisches_Museum_Bremerhaven', description: 'Stadtgeschichte & Kultur', icon: '🏛️' },
  { id: 5, name: 'Haus Z', blenderName: 'Haus_Z', description: 'Modernes Gebäude', icon: '🏢' },
  { id: 6, name: 'Haus K', blenderName: 'Haus_K', description: 'Architektur-Highlight', icon: '🏗️' },
  { id: 7, name: 'Hanse Carré', blenderName: 'Hanse_Carré', description: 'Einkaufszentrum', icon: '🛍️' },
  { id: 8, name: 'Weser Strandbad', blenderName: 'Weser-Strandbad', description: 'Strandbad an der Weser', icon: '🏖️' }
];

// UI Elements
const arInfo = document.getElementById('ar-info');
const controls_ui = document.getElementById('controls');
const poiCard = document.getElementById('poiCard');
const desktopInfo = document.getElementById('desktopInfo');
const dayNightBtn = document.getElementById('dayNightBtn');
const nextPOIBtn = document.getElementById('nextPOIBtn');
const prevPOIBtn = document.getElementById('prevPOIBtn');
const viewPOIBtn = document.getElementById('viewPOIBtn');
const closePOI = document.getElementById('closePOI');

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
  dayLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  dayLight.position.set(0.5, 1, 0.25);
  scene.add(dayLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 5, 5);
  scene.add(dirLight);

  nightLight = new THREE.AmbientLight(0x4444ff, 0.3);
  nightLight.visible = false;
  scene.add(nightLight);

  moonLight = new THREE.DirectionalLight(0x8888ff, 0.5);
  moonLight.position.set(-5, 5, -5);
  moonLight.visible = false;
  scene.add(moonLight);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  // OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.update();

  // Raycaster
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // AR Button
  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ['hit-test', 'local-floor']
  });
  container.appendChild(arButton);

  // AR Session Events
  renderer.xr.addEventListener('sessionstart', () => {
    console.log('🚀 AR Session gestartet');
    desktopInfo.classList.add('hidden');
    arInfo.classList.remove('hidden');
    controls_ui.classList.remove('hidden');
    document.getElementById('secondary-controls').classList.remove('hidden');
    
    if (mapModel) {
      mapModel.visible = false;
      if (activeMarker) activeMarker.visible = false;
      if (character) character.visible = false;
    }
    objectPlaced = false;
    hitTestSourceRequested = false;
    hitTestSource = null;
  });

  renderer.xr.addEventListener('sessionend', () => {
    console.log('🛑 AR Session beendet');
    desktopInfo.classList.remove('hidden');
    arInfo.classList.add('hidden');
    controls_ui.classList.add('hidden');
    document.getElementById('secondary-controls').classList.add('hidden');
    poiCard.classList.add('hidden');
    
    if (mapModel) {
      mapModel.visible = true;
      if (activeMarker) activeMarker.visible = true;
      if (character) character.visible = true;
      setupDesktopView();
    }
  });

  // Controller
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  // Reticle
  const ringGeometry = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  reticle = new THREE.Mesh(ringGeometry, ringMaterial);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // Modell laden
  loadMapModel();

  // Event Listeners
  window.addEventListener('resize', onWindowResize, false);
  renderer.domElement.addEventListener('click', onMapClick, false);
  
  dayNightBtn.addEventListener('click', toggleDayNight);
  nextPOIBtn.addEventListener('click', goToNextPOI);
  prevPOIBtn.addEventListener('click', goToPrevPOI);
  viewPOIBtn.addEventListener('click', showCurrentPOIInfo);
  closePOI.addEventListener('click', () => poiCard.classList.add('hidden'));
  
  desktopInfo.addEventListener('click', () => {
    desktopInfo.classList.toggle('minimized');
  });
}

function loadMapModel() {
  const loader = new GLTFLoader();
  loader.load('mapBremerhaven2.glb', (gltf) => {
    mapModel = gltf.scene;

    const box = new THREE.Box3().setFromObject(mapModel);
    const size = box.getSize(new THREE.Vector3());

    mapModel.userData.originalMaxDim = Math.max(size.x, size.y, size.z);
    mapModel.userData.originalCenter = box.getCenter(new THREE.Vector3());

    scene.add(mapModel);
    
    // Finde POI-Positionen
    findPOIPositions();
    
    // Erstelle EIN Marker und Character
    createSingleMarker();
    createCharacter();
    
    // Positioniere Marker zur ersten Sehenswürdigkeit
    updateMarkerPosition();
    
    setupDesktopView();
    mapModel.visible = true;

    console.log('✅ Modell geladen:', {
      originalMaxDim: mapModel.userData.originalMaxDim,
      pois: pointsOfInterest.length
    });

  }, undefined, (error) => {
    console.error('❌ Fehler beim Laden des Modells:', error);
  });
}

function findPOIPositions() {
  const originalMaxDim = mapModel.userData.originalMaxDim || 1;
  const normalizeScale = 1.0 / originalMaxDim;
  const modelCenter = mapModel.userData.originalCenter;

  console.log('🔍 Suche POI-Objekte im Modell...');

  mapModel.traverse((child) => {
    pointsOfInterest.forEach((poi) => {
      const childName = child.name.replace(/_/g, ' ').toLowerCase();
      const poiName = poi.blenderName.replace(/_/g, ' ').toLowerCase();
      
      if (childName === poiName || child.name === poi.blenderName) {
        const bbox = new THREE.Box3().setFromObject(child);
        const center = bbox.getCenter(new THREE.Vector3());
        
        poi.position = {
          x: (center.x - modelCenter.x) * normalizeScale,
          y: (center.y - modelCenter.y) * normalizeScale,
          z: (center.z - modelCenter.z) * normalizeScale
        };
        
        console.log(`✓ ${poi.name}:`, poi.position);
      }
    });
  });

  // Fallback für POIs ohne Position
  pointsOfInterest.forEach((poi, index) => {
    if (!poi.position) {
      const angle = (index / pointsOfInterest.length) * Math.PI * 2;
      const radius = 0.3;
      poi.position = {
        x: Math.cos(angle) * radius,
        y: 0,
        z: Math.sin(angle) * radius
      };
      console.warn(`⚠️ Fallback Position für: ${poi.name}`);
    }
  });
}

function createSingleMarker() {
  const markerGroup = new THREE.Group();
  markerGroup.name = 'ActiveMarker';

  // Basis - RIESIG für bessere Sichtbarkeit
  const baseGeometry = new THREE.CylinderGeometry(30, 40, 80, 8);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0xff6b35,
    emissive: 0xff6b35,
    emissiveIntensity: 0.8
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  markerGroup.add(base);

  // Kugel - SEHR leuchtend
  const sphereGeometry = new THREE.SphereGeometry(50, 16, 16);
  const sphereMaterial = new THREE.MeshStandardMaterial({
    color: 0xffff00,
    emissive: 0xffff00,
    emissiveIntensity: 3,
    metalness: 0.3,
    roughness: 0.4
  });
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
  sphere.position.y = 80;
  markerGroup.add(sphere);

  // Pulsierender Ring
  const ringGeometry = new THREE.TorusGeometry(60, 8, 8, 16);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.8
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.position.y = 80;
  ring.rotation.x = Math.PI / 2;
  markerGroup.add(ring);
  markerGroup.userData.ring = ring;

  markerGroup.visible = true;
  mapModel.add(markerGroup);
  activeMarker = markerGroup;
  
  console.log('📍 Einzelner Marker erstellt');
}

function createCharacter() {
  const characterGroup = new THREE.Group();

  // Körper
  const bodyGeometry = new THREE.CylinderGeometry(20, 20, 60, 8);
  const bodyMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x4a90e2,
    emissive: 0x4a90e2,
    emissiveIntensity: 0.3
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 60;
  characterGroup.add(body);

  // Kopf
  const headGeometry = new THREE.SphereGeometry(25, 16, 16);
  const headMaterial = new THREE.MeshStandardMaterial({ 
    color: 0xffdbac,
    emissive: 0xffdbac,
    emissiveIntensity: 0.2
  });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = 110;
  characterGroup.add(head);

  characterGroup.position.set(0, 5, 0);
  characterGroup.visible = true;
  mapModel.add(characterGroup);
  
  character = characterGroup;
  console.log('🧍 Character erstellt');
}

function updateMarkerPosition() {
  if (!activeMarker) return;
  
  const currentPOI = pointsOfInterest[currentPOIIndex];
  if (!currentPOI.position) return;

  const targetPos = new THREE.Vector3(
    currentPOI.position.x,
    currentPOI.position.y + 15,
    currentPOI.position.z
  );

  // Animiere Marker zur neuen Position
  animateMarkerTo(targetPos);
  
  // Aktualisiere UI
  updateTourUI();
  
  console.log(`📍 Marker bewegt sich zu: ${currentPOI.name} (${currentPOIIndex + 1}/${pointsOfInterest.length})`);
}

function animateMarkerTo(targetPos) {
  if (!activeMarker) return;

  const startPos = activeMarker.position.clone();
  const duration = 1000;
  const startTime = Date.now();

  function animate() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);

    const eased = progress < 0.5
      ? 2 * progress * progress
      : -1 + (4 - 2 * progress) * progress;

    activeMarker.position.lerpVectors(startPos, targetPos, eased);
    
    // Hüpf-Effekt
    activeMarker.position.y = targetPos.y + Math.sin(progress * Math.PI * 2) * 30;

    // Pulsiere während der Bewegung
    const sphere = activeMarker.children[1];
    if (sphere && sphere.material) {
      sphere.material.emissiveIntensity = 3 + Math.sin(progress * Math.PI * 4) * 1;
    }

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      activeMarker.position.copy(targetPos);
    }
  }

  animate();

  // Bewege auch Character
  if (character) {
    animateCharacterTo(targetPos);
  }
}

function animateCharacterTo(targetPos) {
  if (!character) return;

  const startPos = character.position.clone();
  const duration = 1500;
  const startTime = Date.now();

  function animate() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);

    const eased = progress < 0.5
      ? 2 * progress * progress
      : -1 + (4 - 2 * progress) * progress;

    character.position.lerpVectors(startPos, targetPos, eased);
    character.position.y = 5 + Math.sin(progress * Math.PI * 3) * 30;

    const body = character.children[0];
    if (body && body.material) {
      body.material.emissiveIntensity = 0.3 + Math.sin(progress * Math.PI * 6) * 0.3;
    }

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      character.position.set(targetPos.x, 5, targetPos.z);
    }
  }

  animate();
}

function goToNextPOI() {
  // Markiere aktuelles POI als besucht
  visitedPOIs.add(pointsOfInterest[currentPOIIndex].id);
  
  currentPOIIndex = (currentPOIIndex + 1) % pointsOfInterest.length;
  updateMarkerPosition();
  poiCard.classList.add('hidden');
  
  console.log('➡️ Nächstes POI:', pointsOfInterest[currentPOIIndex].name);
}

function goToPrevPOI() {
  currentPOIIndex = (currentPOIIndex - 1 + pointsOfInterest.length) % pointsOfInterest.length;
  updateMarkerPosition();
  poiCard.classList.add('hidden');
  
  console.log('⬅️ Vorheriges POI:', pointsOfInterest[currentPOIIndex].name);
}

function showCurrentPOIInfo() {
  const currentPOI = pointsOfInterest[currentPOIIndex];
  showPOIInfo(currentPOI);
  visitedPOIs.add(currentPOI.id);
  updateTourUI();
}

function updateTourUI() {
  const currentPOI = pointsOfInterest[currentPOIIndex];
  
  // Update Counter
  document.getElementById('poiCounter').textContent = `${currentPOIIndex + 1}/${pointsOfInterest.length}`;
  document.getElementById('visitedCounter').textContent = `${visitedPOIs.size}/${pointsOfInterest.length}`;
  
  // Update Button Text
  document.getElementById('viewPOIText').textContent = currentPOI.name;
  
  // Prüfe ob alle besucht
  if (visitedPOIs.size === pointsOfInterest.length) {
    showCompletionMessage();
  }
}

function showPOIInfo(poi) {
  document.getElementById('poiIcon').textContent = poi.icon;
  document.getElementById('poiTitle').textContent = poi.name;
  document.getElementById('poiDesc').textContent = poi.description;
  
  const badge = document.getElementById('poiBadge');
  if (visitedPOIs.has(poi.id)) {
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
  
  poiCard.classList.remove('hidden');
}

function showCompletionMessage() {
  arInfo.innerHTML = `
    <h3>
      🎉 Gratulation!
    </h3>
    <p>Du hast alle ${pointsOfInterest.length} Sehenswürdigkeiten von Bremerhaven besucht!</p>
  `;
  setTimeout(() => {
    arInfo.innerHTML = `
      <h3>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        Bremerhaven entdecken
      </h3>
      <p>Navigiere mit ← → durch die Sehenswürdigkeiten!</p>
    `;
  }, 5000);
}

function setupDesktopView() {
  if (!mapModel) return;

  const originalMaxDim = mapModel.userData.originalMaxDim || 1;
  const originalCenter = mapModel.userData.originalCenter || new THREE.Vector3();

  const desktopScale = 2.0 / originalMaxDim;
  mapModel.scale.setScalar(desktopScale);

  mapModel.position.set(
    -originalCenter.x * desktopScale,
    -originalCenter.y * desktopScale,
    -originalCenter.z * desktopScale
  );

  controls.target.set(0, 0, 0);
  controls.update();
  
  console.log('🖥️ Desktop View eingerichtet');
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onSelect() {
  if (!mapModel || !reticle.visible || objectPlaced) return;

  console.log('👆 Modell platziert in AR');

  mapModel.position.setFromMatrixPosition(reticle.matrix);
  mapModel.quaternion.setFromRotationMatrix(reticle.matrix);

  const AR_TARGET_SIZE = 0.8;
  const originalMaxDim = mapModel.userData.originalMaxDim || 1;
  const arScale = AR_TARGET_SIZE / originalMaxDim;

  mapModel.scale.setScalar(arScale);
  mapModel.visible = true;

  if (activeMarker) activeMarker.visible = true;
  if (character) character.visible = true;

  objectPlaced = true;
  reticle.visible = false;
  hitTestSource = null;
}

function onMapClick(event) {
  // Klick auf Marker im Desktop zeigt Info
  if (!renderer.xr.isPresenting && mapModel && mapModel.visible) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    
    if (activeMarker) {
      const intersects = raycaster.intersectObjects(activeMarker.children, true);
      if (intersects.length > 0) {
        showCurrentPOIInfo();
      }
    }
  }
}

function toggleDayNight() {
  isDayMode = !isDayMode;

  dayLight.visible = isDayMode;
  nightLight.visible = !isDayMode;
  moonLight.visible = !isDayMode;

  scene.background = new THREE.Color(isDayMode ? 0xddeeff : 0x1a1a2e);

  const btnText = document.getElementById('dayNightText');
  btnText.textContent = isDayMode ? 'Nacht' : 'Tag';
  
  console.log('🌓 Modus:', isDayMode ? 'Tag' : 'Nacht');
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  if (!renderer.xr.isPresenting) {
    controls.update();
  }

  // Animiere Marker-Ring
  if (activeMarker && activeMarker.userData.ring && activeMarker.visible) {
    activeMarker.userData.ring.rotation.z += 0.02;
    activeMarker.userData.ring.scale.setScalar(1 + Math.sin(timestamp * 0.003) * 0.1);
  }

  if (!renderer.xr.isPresenting || objectPlaced) {
    renderer.render(scene, camera);
    return;
  }

  // Hit-Test Logik
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