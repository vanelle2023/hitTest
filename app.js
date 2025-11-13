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
    let poiMarkers = [];
    let character = null;
    let dayLight, nightLight, moonLight;
    let raycaster, mouse;
    let isDayMode = true;
    let visitedPOIs = new Set();

    // POIs für Bremerhaven - Namen aus Blender-Modell
    const pointsOfInterest = [
      { id: 1, name: 'Klimahaus Bremerhaven', blenderName: 'Klimahaus_Bremerhaven', description: 'Erlebnismuseum der Klimazonen', icon: '🌍' },
      { id: 2, name: 'Radarturm', blenderName: 'Radarturm', description: 'Historischer Radarturm', icon: '📡' },
      { id: 3, name: 'Alter Hafen', blenderName: 'Alter_Hafen', description: 'Traditioneller Hafen', icon: '⚓' },
      { id: 4, name: 'Historisches Museum', blenderName: 'Historisches_Museum_Bremerhaven', description: 'Stadtgeschichte & Kultur', icon: '🏛️' },
      { id: 5, name: 'Haus Z', blenderName: 'Haus_Z', description: 'Modernes Gebäude', icon: '🏢' },
      { id: 6, name: 'Haus K', blenderName: 'Haus_K', description: 'Architektur-Highlight', icon: '🏗️' },
      { id: 7, name: 'Hanse Carré', blenderName: 'Hanse_Carré', description: 'Einkaufszentrum', icon: '🛍️' },
      { id: 8, name: 'Weser Strandbad', blenderName: 'Weser_Strandbad', description: 'Strandbad an der Weser', icon: '🏖️' }
    ];

    // UI Elements
    const arInfo = document.getElementById('ar-info');
    const controls_ui = document.getElementById('controls');
    const poiCard = document.getElementById('poiCard');
    const desktopInfo = document.getElementById('desktopInfo');
    const dayNightBtn = document.getElementById('dayNightBtn');
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
        desktopInfo.classList.add('hidden');
        arInfo.classList.remove('hidden');
        controls_ui.classList.remove('hidden');
        
        if (mapModel) mapModel.visible = false;
        objectPlaced = false;
        hitTestSourceRequested = false;
        hitTestSource = null;
      });

      renderer.xr.addEventListener('sessionend', () => {
        desktopInfo.classList.remove('hidden');
        arInfo.classList.add('hidden');
        controls_ui.classList.add('hidden');
        poiCard.classList.add('hidden');
        
        if (mapModel) {
          mapModel.visible = true;
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
      renderer.domElement.addEventListener('touchend', onMapClick, false);
      
      dayNightBtn.addEventListener('click', toggleDayNight);
      closePOI.addEventListener('click', () => poiCard.classList.add('hidden'));
      
      // Desktop Info minimieren beim Klicken
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
        setupDesktopView();
        mapModel.visible = true;

        // WICHTIG: Marker-Positionen aus Blender-Objekten holen
        positionPOIMarkers();
        
        createPOIMarkers();
        createCharacter();

      }, undefined, (error) => {
        console.error('Fehler beim Laden des Modells:', error);
      });
    }

    function positionPOIMarkers() {
      // Durchsuche das geladene Modell nach Objekten mit POI-Namen
      mapModel.traverse((child) => {
        pointsOfInterest.forEach((poi, index) => {
          // Vergleiche Name (ignoriere Groß-/Kleinschreibung und ersetze Unterstriche)
          const childName = child.name.replace(/_/g, ' ').toLowerCase();
          const poiName = poi.blenderName.replace(/_/g, ' ').toLowerCase();
          
          if (childName === poiName || child.name === poi.blenderName) {
            // Objekt gefunden! Berechne Zentrum
            const bbox = new THREE.Box3().setFromObject(child);
            const center = bbox.getCenter(new THREE.Vector3());
            
            // WICHTIG: Position ist relativ zum Modell (nicht absolut!)
            // Wir speichern die Weltposition relativ zum Modell-Zentrum
            const modelCenter = mapModel.userData.originalCenter;
            
            poi.position = {
              x: center.x - modelCenter.x,
              y: center.y - modelCenter.y,
              z: center.z - modelCenter.z
            };
            
            console.log(`✓ POI gefunden: ${poi.name} - Relative Position:`, poi.position);
          }
        });
      });

      // Setze Marker-Positionen RELATIV zum Modell
      poiMarkers.forEach((marker, index) => {
        const poi = pointsOfInterest[index];
        if (poi.position) {
          // Marker wird child vom mapModel, damit er mit skaliert
          marker.position.set(poi.position.x, poi.position.y + 0.02, poi.position.z);
          mapModel.add(marker); // WICHTIG: Marker ist jetzt child von mapModel!
          console.log(`✓ Marker platziert für: ${poi.name}`);
        } else {
          console.warn(`⚠️ Objekt nicht gefunden in Blender-Modell: ${poi.blenderName}`);
          marker.position.set(0, 0.01, 0);
          mapModel.add(marker);
        }
      });
    }

    function createPOIMarkers() {
      pointsOfInterest.forEach(poi => {
        const markerGroup = new THREE.Group();

        // Basis
        const baseGeometry = new THREE.CylinderGeometry(0.008, 0.01, 0.02, 8);
        const baseMaterial = new THREE.MeshStandardMaterial({
          color: 0xff6b35,
          emissive: 0xff6b35,
          emissiveIntensity: 0.5
        });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        markerGroup.add(base);

        // Kugel
        const sphereGeometry = new THREE.SphereGeometry(0.012, 16, 16);
        const sphereMaterial = new THREE.MeshStandardMaterial({
          color: 0xffaa00,
          emissive: 0xffaa00,
          emissiveIntensity: 1
        });
        const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        sphere.position.y = 0.02;
        markerGroup.add(sphere);

        // Ring
        const ringGeometry = new THREE.TorusGeometry(0.015, 0.002, 8, 16);
        const ringMaterial = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.6
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.position.y = 0.02;
        ring.rotation.x = Math.PI / 2;
        markerGroup.add(ring);
        markerGroup.userData.ring = ring;

        // Position wird später gesetzt, wenn Modell geladen ist
        markerGroup.userData.poi = poi;
        markerGroup.visible = false;

        scene.add(markerGroup);
        poiMarkers.push(markerGroup);
      });
    }

    function createCharacter() {
      const characterGroup = new THREE.Group();

      // Körper
      const bodyGeometry = new THREE.CylinderGeometry(0.005, 0.005, 0.015, 8);
      const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x4a90e2 });
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      body.position.y = 0.015;
      characterGroup.add(body);

      // Kopf
      const headGeometry = new THREE.SphereGeometry(0.006, 16, 16);
      const headMaterial = new THREE.MeshStandardMaterial({ color: 0xffdbac });
      const head = new THREE.Mesh(headGeometry, headMaterial);
      head.position.y = 0.028;
      characterGroup.add(head);

      // Character wird child vom Modell (damit er mit skaliert)
      characterGroup.position.set(0, 0.001, 0);
      characterGroup.visible = false;

      // Warte bis Modell geladen ist
      if (mapModel) {
        mapModel.add(characterGroup);
      }
      
      character = characterGroup;
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
    }

    function onWindowResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }

    function onSelect() {
      if (!mapModel || !reticle.visible || objectPlaced) return;

      mapModel.position.setFromMatrixPosition(reticle.matrix);
      mapModel.quaternion.setFromRotationMatrix(reticle.matrix);

      const AR_TARGET_SIZE = 0.3;
      const originalMaxDim = mapModel.userData.originalMaxDim || 1;
      const arScale = AR_TARGET_SIZE / originalMaxDim;

      mapModel.scale.setScalar(arScale);
      mapModel.visible = true;

      // POI Marker sichtbar machen
      poiMarkers.forEach(marker => {
        marker.visible = true;
      });

      // Character sichtbar machen
      if (character) {
        character.visible = true;
      }

      objectPlaced = true;
      reticle.visible = false;
      hitTestSource = null;
    }

    function onMapClick(event) {
      if (!objectPlaced || !renderer.xr.isPresenting) return;

      const rect = renderer.domElement.getBoundingClientRect();
      let x, y;

      if (event.touches && event.touches.length > 0) {
        x = event.touches[0].clientX;
        y = event.touches[0].clientY;
      } else {
        x = event.clientX;
        y = event.clientY;
      }

      mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((y - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(poiMarkers, true);

      if (intersects.length > 0) {
        let marker = intersects[0].object;
        
        // Finde das Marker-Group (parent könnte mehrere Ebenen hoch sein)
        while (marker && !marker.userData.poi) {
          marker = marker.parent;
        }
        
        if (marker && marker.userData.poi) {
          const poi = marker.userData.poi;
          showPOIInfo(poi);
          visitedPOIs.add(poi.id);
          updatePOICounter();

          if (character) {
            const worldPos = new THREE.Vector3();
            marker.getWorldPosition(worldPos);
            animateCharacterTo(worldPos);
          }
        }
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

    function updatePOICounter() {
      document.getElementById('poiCounter').textContent = `${visitedPOIs.size}/8`;
    }

    function animateCharacterTo(targetWorldPos) {
      if (!character) return;

      // Konvertiere Weltposition zu lokaler Position relativ zum Modell
      const targetLocalPos = mapModel.worldToLocal(targetWorldPos.clone());
      const startPos = character.position.clone();
      const duration = 1000;
      const startTime = Date.now();

      function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        const eased = progress < 0.5
          ? 2 * progress * progress
          : -1 + (4 - 2 * progress) * progress;

        character.position.lerpVectors(startPos, targetLocalPos, eased);
        character.position.y = 0.001 + Math.sin(progress * Math.PI) * 0.01;

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      }

      animate();
    }

    function toggleDayNight() {
      isDayMode = !isDayMode;

      dayLight.visible = isDayMode;
      nightLight.visible = !isDayMode;
      moonLight.visible = !isDayMode;

      scene.background = new THREE.Color(isDayMode ? 0xddeeff : 0x1a1a2e);

      const btnText = document.getElementById('dayNightText');
      btnText.textContent = isDayMode ? 'Nacht' : 'Tag';
    }

    function animate() {
      renderer.setAnimationLoop(render);
    }

    function render(timestamp, frame) {
      if (!renderer.xr.isPresenting) {
        controls.update();
      }

      // Animiere POI Marker
      poiMarkers.forEach(marker => {
        if (marker.userData.ring) {
          marker.userData.ring.rotation.z += 0.02;
          marker.userData.ring.scale.setScalar(1 + Math.sin(timestamp * 0.003) * 0.1);
        }
      });

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