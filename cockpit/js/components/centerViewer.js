/**
 * ============================================================================
 * JARVIS COCKPIT — CENTER 3D VEHICLE VIEWER COMPONENT
 * ============================================================================
 * Manages the Three.js viewport, camera presets, real-time 1:1 MPU6050
 * orientation mapping, and drag-and-drop external GLTF/GLB model loading.
 * ============================================================================
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AudiQ7Model } from '../three/AudiQ7Model.js';

export class CenterViewer {
  constructor(containerElement) {
    this.container = containerElement;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.audiModel = null;
    this.customModel = null;

    // Camera preset targets
    this.cameraPresets = {
      isometric: { pos: new THREE.Vector3(5.2, 3.0, 5.2), target: new THREE.Vector3(0, 0.75, 0) },
      front:     { pos: new THREE.Vector3(0.0, 1.4, -6.0), target: new THREE.Vector3(0, 0.75, 0) },
      top:       { pos: new THREE.Vector3(0.0, 8.5, 0.05), target: new THREE.Vector3(0, 0.0, 0) },
      side:      { pos: new THREE.Vector3(-6.2, 1.4, 0.0), target: new THREE.Vector3(0, 0.75, 0) }
    };

    this.activePreset = 'isometric';
    this.transitioning = false;
    this.targetCameraPos = new THREE.Vector3().copy(this.cameraPresets.isometric.pos);
    this.targetCameraLook = new THREE.Vector3().copy(this.cameraPresets.isometric.target);

    // Real-Time Sensor Registers (High responsiveness)
    this.targetPitch = 0;
    this.targetRoll = 0;
    this.targetYaw = 0;
    this.smoothedPitch = 0;
    this.smoothedRoll = 0;
    this.smoothedYaw = 0;
    this.smoothingSpeed = 24.0; // Snappy real-time response

    // Calibration offsets
    this.pitchOffset = 0;
    this.rollOffset = 0;
    this.yawOffset = 0;

    // Movement state (Independent Drive & Steer)
    this.driveState = 'STOP';
    this.steerState = 'CENTER';
    this.speed = 190;

    this.lastTime = performance.now();

    this.init();
    this.setupDragAndDrop();
  }

  init() {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 500;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x06090E, 0.038);

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    this.camera.position.copy(this.cameraPresets.isometric.pos);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    this.container.appendChild(this.renderer.domElement);

    // 4. Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.05;
    this.controls.minDistance = 2.0;
    this.controls.maxDistance = 15.0;
    this.controls.target.copy(this.cameraPresets.isometric.target);

    // 5. Lighting Setup
    this.setupLighting();

    // 6. Holographic Floor & Grid
    this.setupEnvironment();

    // 7. Add Audi Q7 Model
    this.audiModel = new AudiQ7Model();
    this.scene.add(this.audiModel.group);

    // 8. Event Listeners
    window.addEventListener('resize', () => this.onResize());
    
    // Start animation loop
    this.animate();
  }

  setupLighting() {
    const ambientLight = new THREE.AmbientLight(0x223046, 2.0);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xF8FAFC, 2.6);
    keyLight.position.set(6, 10, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    this.scene.add(keyLight);

    const cyanRim = new THREE.DirectionalLight(0x00F0FF, 2.2);
    cyanRim.position.set(-6, 5, -6);
    this.scene.add(cyanRim);

    const fillLight = new THREE.PointLight(0x38BDF8, 1.2, 16);
    fillLight.position.set(0, 3, 5);
    this.scene.add(fillLight);
  }

  setupEnvironment() {
    const gridHelper = new THREE.GridHelper(24, 24, 0x00F0FF, 0x112234);
    gridHelper.position.y = -0.01;
    this.scene.add(gridHelper);

    const floorGeo = new THREE.CircleGeometry(12, 32);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x05080C,
      roughness: 0.85,
      metalness: 0.2
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.02;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);
  }

  setupDragAndDrop() {
    const el = this.container;

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.style.boxShadow = 'inset 0 0 30px rgba(0, 240, 255, 0.4)';
    });

    el.addEventListener('dragleave', (e) => {
      e.preventDefault();
      el.style.boxShadow = 'none';
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.style.boxShadow = 'none';

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.parseAndLoadModelFile(e.dataTransfer.files[0]);
      }
    });

    // File input change handler
    const fileInput = document.getElementById('input-model-file');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.parseAndLoadModelFile(e.target.files[0]);
        }
      });
    }
  }

  parseAndLoadModelFile(file) {
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.glb') || fileName.endsWith('.gltf')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const loader = new GLTFLoader();
        loader.parse(event.target.result, '', (gltf) => {
          this.loadCustomGltf(gltf.scene);
        }, (err) => {
          console.error('[GLTF Loader] Error loading file:', err);
        });
      };
      reader.readAsArrayBuffer(file);
    }
  }

  loadCustomGltf(gltfScene) {
    if (!this.audiModel) return;

    // Clear previous custom model if any
    if (this.customModel) {
      this.audiModel.carBody.remove(this.customModel);
    }

    // Hide procedural body meshes while keeping sensor & underglow
    if (this.audiModel.chassis) {
      this.audiModel.chassis.visible = false;
    }

    // Auto-scale and center the loaded 3D model
    const box = new THREE.Box3().setFromObject(gltfScene);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetScale = 4.4 / maxDim; // Normalize to car length ~4.4m
    gltfScene.scale.setScalar(targetScale);

    // Re-center
    const center = box.getCenter(new THREE.Vector3());
    gltfScene.position.sub(center.multiplyScalar(targetScale));
    gltfScene.position.y += 0.4;

    this.customModel = gltfScene;
    this.audiModel.carBody.add(this.customModel);

    // Update HUD indicator badge
    const badge = document.querySelector('.center-hud-overlay .hud-stat-box');
    if (badge) {
      badge.innerHTML = `CHASSIS: <span class="cyan-text">CUSTOM 3D GLTF ACTIVE</span>`;
    }
  }

  setCameraPreset(presetName) {
    if (!this.cameraPresets[presetName]) return;
    this.activePreset = presetName;
    this.targetCameraPos.copy(this.cameraPresets[presetName].pos);
    this.targetCameraLook.copy(this.cameraPresets[presetName].target);
    this.transitioning = true;
  }

  /**
   * Real-time MPU6050 Orientation Input
   */
  updateOrientation(pitch, roll, yaw) {
    this.targetPitch = pitch - this.pitchOffset;
    this.targetRoll  = roll  - this.rollOffset;
    this.targetYaw   = yaw   - this.yawOffset;
  }

  calibrateZero() {
    this.pitchOffset += this.targetPitch;
    this.rollOffset  += this.targetRoll;
    this.yawOffset   += this.targetYaw;
    this.targetPitch = 0;
    this.targetRoll  = 0;
    this.targetYaw   = 0;
    this.smoothedPitch = 0;
    this.smoothedRoll  = 0;
    this.smoothedYaw   = 0;
  }

  setMotionState(driveState, steerState, speed) {
    this.driveState = driveState || 'STOP';
    this.steerState = steerState || 'CENTER';
    this.speed = speed || 190;
  }

  setEmergency(active) {
    if (this.audiModel) {
      this.audiModel.setEmergencyVisuals(active);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const now = performance.now();
    const deltaTime = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // 1. Camera Transitions
    if (this.transitioning) {
      this.camera.position.lerp(this.targetCameraPos, deltaTime * 5.0);
      this.controls.target.lerp(this.targetCameraLook, deltaTime * 5.0);
      if (this.camera.position.distanceTo(this.targetCameraPos) < 0.04) {
        this.transitioning = false;
      }
    } else {
      this.controls.update();
    }

    // 2. Real-Time MPU6050 Orientation Tracking (Snappy & Direct)
    const factor = Math.min(1.0, deltaTime * this.smoothingSpeed);
    this.smoothedPitch += (this.targetPitch - this.smoothedPitch) * factor;
    this.smoothedRoll  += (this.targetRoll  - this.smoothedRoll)  * factor;
    this.smoothedYaw   += (this.targetYaw   - this.smoothedYaw)   * factor;

    // 3. Update Model
    if (this.audiModel) {
      this.audiModel.setOrientation(this.smoothedPitch, this.smoothedRoll, this.smoothedYaw);
      this.audiModel.update(deltaTime, this.driveState, this.steerState, this.speed);
    }

    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}
