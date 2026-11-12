/**
 * ============================================================================
 * JARVIS COCKPIT — AUTHENTIC AUDI Q7 2020 SUV 3D DIGITAL TWIN
 * ============================================================================
 * Faithfully reproduces the 2020 Audi Q7 SUV from official reference photos:
 *  - Iconic 8-sided Singleframe Octagonal Grille with 6 vertical chrome louvers
 *  - 4 interlocking Audi chrome rings & "Q7" license plate placard
 *  - Matrix LED headlights with cool-white segmented DRL eyebrow strip
 *  - Front bumper with trapezoidal side intakes & 3-fin satin silver skid plate
 *  - Raked aerodynamic hood with dual crease lines leading to A-pillars
 *  - Aerodynamic greenhouse with dark panoramic glass & chrome window surround
 *  - Brushed aluminum roof rails & white shark fin antenna
 *  - Lower door satin silver rocker blades & flared muscular wheel arches
 *  - Full-width rear chrome tailgate bar connecting Matrix LED taillights
 *  - Rear apron diffuser with 4 vertical fins & dual trapezoidal chrome exhausts
 *  - Audi Sport 5-arm twin-spoke alloy wheels with disc brakes & cyan calipers
 *  - 100% Orthogonal Zero-Wobble wheel kinematics (Steer on Y, Roll on X)
 *  - Snappy 1:1 real-time MPU6050 Pitch, Roll, and Yaw tracking
 * ============================================================================
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class AudiQ7Model {
  constructor() {
    this.group = new THREE.Group();

    // Root group that rotates with physical MPU6050 readings
    this.carBody = new THREE.Group();
    // Lift car so tires rest perfectly on ground plane (Y = 0)
    this.carBody.position.y = 0.48;
    this.group.add(this.carBody);

    // Procedural model references
    this.proceduralChassis = null;
    this.flKnuckle = null;
    this.frKnuckle = null;
    this.rollingWheels = [];

    // GLB Model References (audi_q7.glb)
    this.glbLoaded = false;
    this.glbChassis = null;
    this.glbSteerKnuckles = []; // Front Left & Front Right steering knuckles
    this.glbRollingAxles = [];  // All 4 wheel rolling axles (FL, FR, RL, RR)

    this.currentSteerAngle = 0;
    this.targetSteerAngle = 0;

    // Lights & FX
    this.headlights = [];
    this.drls = [];
    this.taillights = [];
    this.underglow = null;

    // 1. Build authentic procedural fallback (instant render, zero wait)
    this.buildAudiQ7();

    // 2. Asynchronously load the official uploaded audi_q7.glb digital twin
    this.loadGLB();
  }

  loadGLB() {
    const loader = new GLTFLoader();
    const tryPaths = ['./audi_q7.glb', './assets/models/audi_q7.glb', '/audi_q7.glb'];

    const tryLoad = (idx) => {
      if (idx >= tryPaths.length) return;
      loader.load(
        tryPaths[idx],
        (gltf) => {
          this.setupGLBModel(gltf.scene);
        },
        undefined,
        (err) => {
          console.warn(`[AudiQ7Model] Could not load GLB from ${tryPaths[idx]}, trying next...`, err);
          tryLoad(idx + 1);
        }
      );
    };

    tryLoad(0);
  }

  setupGLBModel(scene) {
    console.log('[AudiQ7Model] Configuring authentic 3D audi_q7.glb model...');

    // Exact vehicle & wheel kinematics centers computed from glTF geometry
    const carCenter = { x: 0.90, y: 0.48, z: 2.19 };
    const wheelDefs = [
      { id: 'wheel1', name: 'Front Right', isFront: true,  cx: -0.15, cy: 0.48, cz: 0.29 },
      { id: 'wheel3', name: 'Front Left',  isFront: true,  cx:  1.95, cy: 0.48, cz: 0.29 },
      { id: 'wheel2', name: 'Rear Right',  isFront: false, cx: -0.15, cy: 0.48, cz: 4.09 },
      { id: 'wheel4', name: 'Rear Left',   isFront: false, cx:  1.95, cy: 0.48, cz: 4.09 }
    ];

    // Find GLTF Scene Root Node or traverse
    let gltfRoot = null;
    scene.traverse((obj) => {
      if (obj.name === 'GLTF_SceneRootNode') gltfRoot = obj;
    });
    if (!gltfRoot) gltfRoot = scene;

    // Prepare containers for wheels and body
    const wheelNodesMap = { wheel1: [], wheel2: [], wheel3: [], wheel4: [] };
    const bodyNodes = [];

    // Separate wheel nodes from chassis body nodes
    const childrenToProcess = [...gltfRoot.children];
    for (const child of childrenToProcess) {
      let isWheel = false;
      for (const w of wheelDefs) {
        if (child.name && child.name.includes(w.id)) {
          wheelNodesMap[w.id].push(child);
          isWheel = true;
          break;
        }
      }
      if (!isWheel) {
        bodyNodes.push(child);
      }
    }

    // 1. Assemble GLB Body Chassis
    this.glbChassis = new THREE.Group();
    this.glbChassis.name = 'GLB_Chassis';
    // Center the body at vehicle origin
    this.glbChassis.position.set(-carCenter.x, -carCenter.y, -carCenter.z);

    for (const node of bodyNodes) {
      this.glbChassis.add(node);
    }
    this.carBody.add(this.glbChassis);

    // 2. Rig all 4 wheels with zero-wobble steering & rolling kinematics
    this.glbSteerKnuckles = [];
    this.glbRollingAxles = [];

    for (const w of wheelDefs) {
      // Knuckle group: Positioned at local wheel center relative to car center
      const knuckle = new THREE.Group();
      knuckle.name = `Knuckle_${w.id}_${w.name}`;
      knuckle.position.set(w.cx - carCenter.x, w.cy - carCenter.y, w.cz - carCenter.z);

      // Rolling axle group: Handles rolling forward/backward on local X axis
      const rollingAxle = new THREE.Group();
      rollingAxle.name = `RollingAxle_${w.id}`;
      knuckle.add(rollingAxle);

      // Reparent wheel meshes with local coordinate offset
      const meshes = wheelNodesMap[w.id];
      for (const meshNode of meshes) {
        meshNode.position.set(
          meshNode.position.x - w.cx,
          meshNode.position.y - w.cy,
          meshNode.position.z - w.cz
        );
        rollingAxle.add(meshNode);
      }

      this.carBody.add(knuckle);

      if (w.isFront) {
        this.glbSteerKnuckles.push(knuckle);
      }
      this.glbRollingAxles.push(rollingAxle);
    }

    // 3. Enhance materials, specular reflections, and shadows
    scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        if (child.material) {
          child.material.envMapIntensity = 1.4;
          // Subtly polish metallic paint reflections
          if (child.material.roughness !== undefined) {
            child.material.roughness = Math.min(child.material.roughness, 0.4);
          }
        }
      }
    });

    // 4. Add Cyberpunk Holographic Underglow to GLB model
    const glowGeo = new THREE.PlaneGeometry(2.35, 4.60);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x00F0FF,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide
    });
    const glbUnderglow = new THREE.Mesh(glowGeo, glowMat);
    glbUnderglow.rotation.x = -Math.PI / 2;
    glbUnderglow.position.set(0, -0.42, 0);
    this.carBody.add(glbUnderglow);
    this.underglow = glbUnderglow;

    // 5. Hide procedural fallback chassis now that authentic GLB model is active
    if (this.proceduralChassis) {
      this.proceduralChassis.visible = false;
    }

    this.glbLoaded = true;
    console.log('[AudiQ7Model] Audi Q7 GLB Digital Twin successfully loaded & rigged.');

    // Update HUD indicator badge if present
    const badge = document.querySelector('.center-hud-overlay .hud-stat-box');
    if (badge) {
      badge.innerHTML = `CHASSIS: <span class="cyan-text">AUDI Q7 3D GLB ACTIVE</span>`;
    }
  }

  buildAudiQ7() {
    // ------------------------------------------------------------------------
    // 1. PREMIUM AUTOMOTIVE MATERIALS (From Reference Photos)
    // ------------------------------------------------------------------------
    // Audi Glacier White Metallic paint (deep specular clearcoat)
    const paintWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xF4F7FA,
      metalness: 0.88,
      roughness: 0.16,
      envMapIntensity: 1.6
    });

    // Dark Anthracite lower aerodynamic body cladding & wheel well trim
    const darkTrimMat = new THREE.MeshStandardMaterial({
      color: 0x14181E,
      roughness: 0.75,
      metalness: 0.20
    });

    // Mirror-Polished Chrome (Grille, 4 rings, tailgate strip, window trim)
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xF1F5F9,
      metalness: 0.98,
      roughness: 0.08
    });

    // Satin Brushed Aluminum (Skid plates, roof rails, lower door blades)
    const satinSilverMat = new THREE.MeshStandardMaterial({
      color: 0xD0D7DE,
      metalness: 0.85,
      roughness: 0.25
    });

    // Dark Honeycomb Grille Mesh backdrop
    const grilleMeshMat = new THREE.MeshStandardMaterial({
      color: 0x0B0E14,
      roughness: 0.88,
      metalness: 0.30
    });

    // Smoked Dark Tint Panoramic Privacy Glass
    const glassTintMat = new THREE.MeshPhysicalMaterial({
      color: 0x081018,
      transparent: true,
      opacity: 0.88,
      roughness: 0.05,
      metalness: 0.30,
      transmission: 0.35
    });

    // Deep Matte Black Tire Rubber
    const tireRubberMat = new THREE.MeshStandardMaterial({
      color: 0x161719,
      roughness: 0.94,
      metalness: 0.06
    });

    // Audi Sport Alloy Diamond-Cut Silver Rims
    const rimAlloyMat = new THREE.MeshStandardMaterial({
      color: 0xD8E0E8,
      metalness: 0.92,
      roughness: 0.16
    });

    // Cross-Drilled Steel Brake Rotor
    const discSteelMat = new THREE.MeshStandardMaterial({
      color: 0xC0C8D0,
      metalness: 0.95,
      roughness: 0.22
    });

    // JARVIS Electric Cyan Performance Brake Caliper
    const caliperJarvisMat = new THREE.MeshStandardMaterial({
      color: 0x00F0FF,
      emissive: 0x004050,
      metalness: 0.85,
      roughness: 0.20
    });

    // Cool-White Matrix LED DRL Eyebrow Glow
    const matrixDrlMat = new THREE.MeshStandardMaterial({
      color: 0xE8FFFF,
      emissive: 0x00F0FF,
      emissiveIntensity: 1.8,
      roughness: 0.10
    });

    // Matrix LED Taillights (Audi Signature Red Light Tubes)
    const matrixTaillightMat = new THREE.MeshStandardMaterial({
      color: 0xFF2035,
      emissive: 0xEE1122,
      emissiveIntensity: 1.6,
      roughness: 0.15
    });

    // Mirror Turn Signal Strip (Amber)
    const indicatorMat = new THREE.MeshStandardMaterial({
      color: 0xFFA500,
      emissive: 0xFF8800,
      emissiveIntensity: 1.2,
      roughness: 0.20
    });

    // ------------------------------------------------------------------------
    // 2. MAIN BODY & CHASSIS HIERARCHY
    // ------------------------------------------------------------------------
    const chassis = new THREE.Group();
    this.chassis = chassis;

    // A. Lower Aerodynamic Underbody & Dark Rocker Cladding
    const underbodyGeo = new THREE.BoxGeometry(1.94, 0.20, 4.55);
    const underbody = new THREE.Mesh(underbodyGeo, darkTrimMat);
    underbody.position.set(0, 0.38, 0);
    chassis.add(underbody);

    // B. Main Body Fuselage (Glacier White Metallic)
    const fuselageGeo = new THREE.BoxGeometry(1.96, 0.58, 4.45);
    const fuselage = new THREE.Mesh(fuselageGeo, paintWhiteMat);
    fuselage.position.set(0, 0.72, 0);
    chassis.add(fuselage);

    // C. Flared Muscular Fender Arches (Front & Rear)
    const createFenderFlare = (x, z) => {
      const archGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.05, 24, 1, true, 0, Math.PI);
      archGeo.rotateZ(Math.PI / 2);
      archGeo.rotateY(Math.PI / 2);
      const arch = new THREE.Mesh(archGeo, paintWhiteMat);
      arch.position.set(x, 0.38, z);
      return arch;
    };
    chassis.add(createFenderFlare(-0.99, -1.35));
    chassis.add(createFenderFlare( 0.99, -1.35));
    chassis.add(createFenderFlare(-0.99,  1.42));
    chassis.add(createFenderFlare( 0.99,  1.42));

    // D. Lower Door Rocker Panel Satin Silver Blades
    const rockerBladeGeo = new THREE.BoxGeometry(0.04, 0.06, 2.30);
    const leftBlade = new THREE.Mesh(rockerBladeGeo, satinSilverMat);
    leftBlade.position.set(-0.99, 0.44, 0.05);
    chassis.add(leftBlade);

    const rightBlade = leftBlade.clone();
    rightBlade.position.x = 0.99;
    chassis.add(rightBlade);

    // ------------------------------------------------------------------------
    // 3. SCULPTED HOOD & A-PILLAR CHARACTER LINES
    // ------------------------------------------------------------------------
    // Sloping Hood
    const hoodGeo = new THREE.BoxGeometry(1.84, 0.16, 1.40);
    const hood = new THREE.Mesh(hoodGeo, paintWhiteMat);
    hood.position.set(0, 1.05, -1.48);
    hood.rotation.x = 0.075; // Slopes forward into the Singleframe grille
    chassis.add(hood);

    // Dual Crisp Hood Crease Lines
    const creaseGeo = new THREE.BoxGeometry(0.025, 0.03, 1.35);
    const leftCrease = new THREE.Mesh(creaseGeo, chromeMat);
    leftCrease.position.set(-0.52, 1.14, -1.48);
    leftCrease.rotation.x = 0.075;
    leftCrease.rotation.y = -0.05;
    chassis.add(leftCrease);

    const rightCrease = leftCrease.clone();
    rightCrease.position.x = 0.52;
    rightCrease.rotation.y = 0.05;
    chassis.add(rightCrease);

    // ------------------------------------------------------------------------
    // 4. ICONIC AUDI OCTAGONAL SINGLEFRAME GRILLE (Reference Images)
    // ------------------------------------------------------------------------
    // Authentic 8-sided Octagonal Grille Outline
    const octShape = new THREE.Shape();
    const wTop = 0.54, wMid = 0.60, wBot = 0.46;
    const yTop = 0.34, yMid = 0.18, yBot = -0.28;

    octShape.moveTo(-wTop, yTop);
    octShape.lineTo( wTop, yTop);      // Top horizontal edge
    octShape.lineTo( wMid, yMid);      // Top-right chamfer
    octShape.lineTo( wMid, -0.12);     // Right vertical side
    octShape.lineTo( wBot, yBot);      // Bottom-right chamfer
    octShape.lineTo(-wBot, yBot);      // Bottom horizontal edge
    octShape.lineTo(-wMid, -0.12);     // Bottom-left chamfer
    octShape.lineTo(-wMid, yMid);      // Left vertical side
    octShape.closePath();

    // Octagonal Chrome Surround Bevel
    const extrudeSettings = { depth: 0.06, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.02, bevelThickness: 0.02 };
    const grilleFrameGeo = new THREE.ExtrudeGeometry(octShape, extrudeSettings);
    grilleFrameGeo.center();
    const grilleFrame = new THREE.Mesh(grilleFrameGeo, chromeMat);
    grilleFrame.position.set(0, 0.72, -2.25);
    chassis.add(grilleFrame);

    // Dark Honeycomb Grille Core
    const grilleBackGeo = new THREE.ShapeGeometry(octShape);
    grilleBackGeo.center();
    const grilleBack = new THREE.Mesh(grilleBackGeo, grilleMeshMat);
    grilleBack.position.set(0, 0.72, -2.255);
    chassis.add(grilleBack);

    // 6 Vertical Dual-Chrome Louvers
    const slatPositions = [-0.40, -0.24, -0.08, 0.08, 0.24, 0.40];
    slatPositions.forEach((posX) => {
      const slatGeo = new THREE.BoxGeometry(0.024, 0.52, 0.04);
      const slat = new THREE.Mesh(slatGeo, chromeMat);
      slat.position.set(posX, 0.72, -2.27);
      chassis.add(slat);
    });

    // 4 Interlocking Audi Chrome Rings
    for (let r = 0; r < 4; r++) {
      const ringGeo = new THREE.TorusGeometry(0.042, 0.007, 12, 28);
      const ring = new THREE.Mesh(ringGeo, chromeMat);
      ring.position.set((r - 1.5) * 0.062, 0.90, -2.285);
      chassis.add(ring);
    }

    // Horizontal "Q7" License Plate Placard
    const plateGeo = new THREE.BoxGeometry(0.54, 0.11, 0.03);
    const plate = new THREE.Mesh(plateGeo, satinSilverMat);
    plate.position.set(0, 0.62, -2.28);
    chassis.add(plate);

    // "Q7" Text Badge on Plate
    const badgeGeo = new THREE.BoxGeometry(0.12, 0.05, 0.035);
    const badge = new THREE.Mesh(badgeGeo, darkTrimMat);
    badge.position.set(0, 0.62, -2.285);
    chassis.add(badge);

    // Lower Front Bumper Satin Silver Skid Plate (with 3 teeth)
    const skidGeo = new THREE.BoxGeometry(1.24, 0.08, 0.18);
    const frontSkid = new THREE.Mesh(skidGeo, satinSilverMat);
    frontSkid.position.set(0, 0.35, -2.22);
    chassis.add(frontSkid);

    for (let t = -1; t <= 1; t++) {
      const toothGeo = new THREE.BoxGeometry(0.08, 0.05, 0.20);
      const tooth = new THREE.Mesh(toothGeo, satinSilverMat);
      tooth.position.set(t * 0.32, 0.33, -2.23);
      chassis.add(tooth);
    }

    // ------------------------------------------------------------------------
    // 5. MATRIX LED HEADLIGHTS & FRONT AIR INTAKES
    // ------------------------------------------------------------------------
    // Front Bumper Deep Trapezoidal Side Intakes
    const intakeGeo = new THREE.BoxGeometry(0.36, 0.28, 0.12);
    const leftIntake = new THREE.Mesh(intakeGeo, darkTrimMat);
    leftIntake.position.set(-0.76, 0.58, -2.22);
    leftIntake.rotation.y = 0.14;
    chassis.add(leftIntake);

    // Intake horizontal aerodynamic blade
    const bladeGeo = new THREE.BoxGeometry(0.34, 0.025, 0.14);
    const leftIntakeBlade = new THREE.Mesh(bladeGeo, chromeMat);
    leftIntakeBlade.position.set(-0.76, 0.58, -2.23);
    leftIntakeBlade.rotation.y = 0.14;
    chassis.add(leftIntakeBlade);

    const rightIntake = leftIntake.clone();
    rightIntake.position.x = 0.76;
    rightIntake.rotation.y = -0.14;
    chassis.add(rightIntake);

    const rightIntakeBlade = leftIntakeBlade.clone();
    rightIntakeBlade.position.x = 0.76;
    rightIntakeBlade.rotation.y = -0.14;
    chassis.add(rightIntakeBlade);

    // Matrix LED Headlight Housing
    const hlHousingGeo = new THREE.BoxGeometry(0.44, 0.14, 0.18);
    const leftHl = new THREE.Mesh(hlHousingGeo, darkTrimMat);
    leftHl.position.set(-0.74, 0.94, -2.18);
    leftHl.rotation.y = 0.12;
    chassis.add(leftHl);

    // Top Segmented DRL Eyebrow Tube (Cyan / Cool White)
    const drlGeo = new THREE.BoxGeometry(0.42, 0.03, 0.19);
    const leftDrl = new THREE.Mesh(drlGeo, matrixDrlMat);
    leftDrl.position.set(-0.74, 0.99, -2.185);
    leftDrl.rotation.y = 0.12;
    chassis.add(leftDrl);
    this.headlights.push(leftDrl);
    this.drls.push(leftDrl);

    // Dual Projector LED Lenses
    for (let p = 0; p < 2; p++) {
      const lensGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.04, 16);
      lensGeo.rotateX(Math.PI / 2);
      const lens = new THREE.Mesh(lensGeo, matrixDrlMat);
      lens.position.set(-0.66 - p * 0.14, 0.92, -2.26);
      chassis.add(lens);
      this.headlights.push(lens);
    }

    // Mirror Right Headlight
    const rightHl = leftHl.clone();
    rightHl.position.x = 0.74;
    rightHl.rotation.y = -0.12;
    chassis.add(rightHl);

    const rightDrl = leftDrl.clone();
    rightDrl.position.x = 0.74;
    rightDrl.rotation.y = -0.12;
    chassis.add(rightDrl);
    this.headlights.push(rightDrl);
    this.drls.push(rightDrl);

    for (let p = 0; p < 2; p++) {
      const lensGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.04, 16);
      lensGeo.rotateX(Math.PI / 2);
      const lens = new THREE.Mesh(lensGeo, matrixDrlMat);
      lens.position.set(0.66 + p * 0.14, 0.92, -2.26);
      chassis.add(lens);
      this.headlights.push(lens);
    }

    // ------------------------------------------------------------------------
    // 6. GREENHOUSE, PANORAMIC ROOF & CHROME SILL SURROUND
    // ------------------------------------------------------------------------
    // Dark Tint Cabin Greenhouse
    const cabinGeo = new THREE.BoxGeometry(1.68, 0.65, 2.65);
    const cabin = new THREE.Mesh(cabinGeo, glassTintMat);
    cabin.position.set(0, 1.34, 0.32);
    chassis.add(cabin);

    // Continuous Chrome Window Sill Molding (Signature Audi Q7 trim)
    const sillGeo = new THREE.BoxGeometry(1.72, 0.03, 2.68);
    const sill = new THREE.Mesh(sillGeo, chromeMat);
    sill.position.set(0, 1.05, 0.32);
    chassis.add(sill);

    // Solid Glacier White Roof
    const roofGeo = new THREE.BoxGeometry(1.64, 0.06, 2.50);
    const roof = new THREE.Mesh(roofGeo, paintWhiteMat);
    roof.position.set(0, 1.68, 0.32);
    chassis.add(roof);

    // Panoramic Sunroof Glass Insert
    const sunRoofGeo = new THREE.BoxGeometry(1.30, 0.07, 1.80);
    const sunRoof = new THREE.Mesh(sunRoofGeo, glassTintMat);
    sunRoof.position.set(0, 1.685, 0.20);
    chassis.add(sunRoof);

    // Brushed Aluminum Roof Rails
    const railGeo = new THREE.CylinderGeometry(0.018, 0.018, 2.30, 12);
    railGeo.rotateX(Math.PI / 2);
    const leftRail = new THREE.Mesh(railGeo, satinSilverMat);
    leftRail.position.set(-0.76, 1.74, 0.32);
    chassis.add(leftRail);

    const rightRail = leftRail.clone();
    rightRail.position.x = 0.76;
    chassis.add(rightRail);

    // White Shark Fin Antenna
    const sharkGeo = new THREE.ConeGeometry(0.045, 0.12, 4);
    sharkGeo.rotateX(-Math.PI / 8);
    const sharkFin = new THREE.Mesh(sharkGeo, paintWhiteMat);
    sharkFin.position.set(0, 1.75, 1.40);
    chassis.add(sharkFin);

    // Two-Tone Side Mirrors with Amber LED Turn Strip
    const createSideMirror = (isLeft) => {
      const mirrorGroup = new THREE.Group();
      const x = isLeft ? -1.04 : 1.04;

      // Dark Stalk Mount
      const stalkGeo = new THREE.BoxGeometry(0.08, 0.04, 0.06);
      const stalk = new THREE.Mesh(stalkGeo, darkTrimMat);
      stalk.position.set(isLeft ? 0.04 : -0.04, 0, 0);
      mirrorGroup.add(stalk);

      // White Mirror Cap
      const capGeo = new THREE.BoxGeometry(0.22, 0.11, 0.14);
      const cap = new THREE.Mesh(capGeo, paintWhiteMat);
      mirrorGroup.add(cap);

      // Amber LED Turn Signal Strip
      const indGeo = new THREE.BoxGeometry(0.225, 0.018, 0.08);
      const ind = new THREE.Mesh(indGeo, indicatorMat);
      ind.position.set(0, -0.01, 0.02);
      mirrorGroup.add(ind);

      mirrorGroup.position.set(x, 1.20, -0.85);
      return mirrorGroup;
    };
    chassis.add(createSideMirror(true));
    chassis.add(createSideMirror(false));

    // ------------------------------------------------------------------------
    // 7. REAR FASCIA & TAILGATE (From Reference Images)
    // ------------------------------------------------------------------------
    // Full-Width Polished Chrome Tailgate Bar (Connects Taillights)
    const rearChromeBarGeo = new THREE.BoxGeometry(1.58, 0.035, 0.04);
    const rearChromeBar = new THREE.Mesh(rearChromeBarGeo, chromeMat);
    rearChromeBar.position.set(0, 0.94, 2.24);
    chassis.add(rearChromeBar);

    // 4 Interlocking Audi Rings on Tailgate
    for (let r = 0; r < 4; r++) {
      const ringGeo = new THREE.TorusGeometry(0.032, 0.005, 10, 24);
      const ring = new THREE.Mesh(ringGeo, chromeMat);
      ring.position.set((r - 1.5) * 0.048, 1.06, 2.245);
      chassis.add(ring);
    }

    // Matrix LED Taillights with Horizontal Neon Strip
    const tlGeo = new THREE.BoxGeometry(0.46, 0.11, 0.10);
    const leftTl = new THREE.Mesh(tlGeo, matrixTaillightMat);
    leftTl.position.set(-0.70, 0.94, 2.22);
    chassis.add(leftTl);
    this.taillights.push(leftTl);

    const rightTl = leftTl.clone();
    rightTl.position.x = 0.70;
    chassis.add(rightTl);
    this.taillights.push(rightTl);

    // Integrated Roof Spoiler
    const spoilerGeo = new THREE.BoxGeometry(1.64, 0.06, 0.28);
    const spoiler = new THREE.Mesh(spoilerGeo, paintWhiteMat);
    spoiler.position.set(0, 1.68, 1.62);
    chassis.add(spoiler);

    // Third Center High-Mount Brake Light
    const chmslGeo = new THREE.BoxGeometry(0.38, 0.025, 0.03);
    const chmsl = new THREE.Mesh(chmslGeo, matrixTaillightMat);
    chmsl.position.set(0, 1.66, 1.74);
    chassis.add(chmsl);
    this.taillights.push(chmsl);

    // Rear Diffuser with 4 Vertical Fins & Dual Chrome Trapezoidal Exhausts
    const diffuserGeo = new THREE.BoxGeometry(1.36, 0.16, 0.12);
    const diffuser = new THREE.Mesh(diffuserGeo, satinSilverMat);
    diffuser.position.set(0, 0.38, 2.24);
    chassis.add(diffuser);

    for (let f = -1.5; f <= 1.5; f += 1) {
      const finGeo = new THREE.BoxGeometry(0.025, 0.14, 0.14);
      const fin = new THREE.Mesh(finGeo, satinSilverMat);
      fin.position.set(f * 0.28, 0.38, 2.25);
      chassis.add(fin);
    }

    // Dual Trapezoidal Chrome Exhaust Outlets
    const exhGeo = new THREE.BoxGeometry(0.22, 0.08, 0.14);
    const leftExh = new THREE.Mesh(exhGeo, chromeMat);
    leftExh.position.set(-0.74, 0.38, 2.24);
    chassis.add(leftExh);

    const rightExh = leftExh.clone();
    rightExh.position.x = 0.74;
    chassis.add(rightExh);

    // ------------------------------------------------------------------------
    // 8. DIGITAL TWIN HARDWARE SENSORS (Onboard ESP32 Modules)
    // ------------------------------------------------------------------------
    // GPS Antenna Module (Top Roof Puck)
    const gpsPuckGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.04, 16);
    const gpsPuck = new THREE.Mesh(gpsPuckGeo, darkTrimMat);
    gpsPuck.position.set(0, 1.74, 1.15);
    chassis.add(gpsPuck);

    // MPU6050 Central IMU Core (Luminescent Cyan Node)
    const imuNodeGeo = new THREE.BoxGeometry(0.08, 0.04, 0.08);
    const imuNode = new THREE.Mesh(imuNodeGeo, new THREE.MeshBasicMaterial({ color: 0x00F0FF }));
    imuNode.position.set(0, 0.55, 0);
    chassis.add(imuNode);

    // ------------------------------------------------------------------------
    // 9. AUDI SPORT 5-ARM TWIN-SPOKE ALLOY WHEELS (Zero-Wobble Orthogonal Rig)
    // ------------------------------------------------------------------------
    /**
     * KINEMATIC PRINCIPLE:
     * 1. Knuckle group: positioned at (±trackX, wheelY, ±wheelZ). Rotates ONLY on Y (yaw) for steering.
     * 2. Brake caliper stays in Knuckle group (stationary, does not rotate with wheel roll).
     * 3. Hub group: added to Knuckle. Rotates ONLY on X (pitch) for wheel roll.
     * 4. Wheel geometries are pre-rotated 90 deg on Z so circular face is on X.
     * ZERO Euler gimbal coupling = ZERO WOBBLE!
     */
    const createZeroWobbleWheelAssembly = (isFront) => {
      const knuckle = new THREE.Group();

      // Non-rotating Brake Caliper (Electric Cyan JARVIS accent)
      const caliperGeo = new THREE.BoxGeometry(0.09, 0.15, 0.11);
      const caliper = new THREE.Mesh(caliperGeo, caliperJarvisMat);
      caliper.position.set(0, 0.16, 0.02);
      knuckle.add(caliper);

      // Rolling Hub (Rotates on X)
      const hubRolling = new THREE.Group();
      knuckle.add(hubRolling);

      // A. Premium SUV Low-Profile Tire
      const tireGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 32);
      tireGeo.rotateZ(Math.PI / 2); // Aligns cylinder along X-axis
      const tire = new THREE.Mesh(tireGeo, tireRubberMat);
      hubRolling.add(tire);

      // B. Alloy Rim Barrel
      const rimGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.29, 24);
      rimGeo.rotateZ(Math.PI / 2);
      const rim = new THREE.Mesh(rimGeo, rimAlloyMat);
      hubRolling.add(rim);

      // C. Cross-Drilled Steel Brake Rotor
      const discGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.025, 24);
      discGeo.rotateZ(Math.PI / 2);
      const disc = new THREE.Mesh(discGeo, discSteelMat);
      hubRolling.add(disc);

      // D. Audi Sport 5-Arm Twin-Spoke Details (10 spokes total)
      for (let s = 0; s < 5; s++) {
        const baseAngle = (s * Math.PI * 2) / 5;
        // Twin paired spokes
        [-0.08, 0.08].forEach((offsetAngle) => {
          const ang = baseAngle + offsetAngle;
          const spokeGeo = new THREE.BoxGeometry(0.295, 0.18, 0.032);
          const spoke = new THREE.Mesh(spokeGeo, chromeMat);
          spoke.position.y = Math.cos(ang) * 0.13;
          spoke.position.z = Math.sin(ang) * 0.13;
          spoke.rotation.x = -ang;
          hubRolling.add(spoke);
        });
      }

      // E. Center Hub Cap with Audi Emblem
      const centerCapGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.30, 16);
      centerCapGeo.rotateZ(Math.PI / 2);
      const centerCap = new THREE.Mesh(centerCapGeo, darkTrimMat);
      hubRolling.add(centerCap);

      return { knuckle, hubRolling };
    };

    const wheelY = 0.38;
    const trackX = 0.98;
    const frontZ = -1.35;
    const rearZ  =  1.42;

    // FRONT LEFT (Steering Knuckle + Rolling Hub)
    const fl = createZeroWobbleWheelAssembly(true);
    this.flKnuckle = fl.knuckle;
    this.flKnuckle.position.set(-trackX, wheelY, frontZ);
    this.rollingWheels.push(fl.hubRolling);
    chassis.add(this.flKnuckle);

    // FRONT RIGHT
    const fr = createZeroWobbleWheelAssembly(true);
    this.frKnuckle = fr.knuckle;
    this.frKnuckle.position.set(trackX, wheelY, frontZ);
    this.rollingWheels.push(fr.hubRolling);
    chassis.add(this.frKnuckle);

    // REAR LEFT
    const rl = createZeroWobbleWheelAssembly(false);
    rl.knuckle.position.set(-trackX, wheelY, rearZ);
    this.rollingWheels.push(rl.hubRolling);
    chassis.add(rl.knuckle);

    // REAR RIGHT
    const rr = createZeroWobbleWheelAssembly(false);
    rr.knuckle.position.set(trackX, wheelY, rearZ);
    this.rollingWheels.push(rr.hubRolling);
    chassis.add(rr.knuckle);

    // ------------------------------------------------------------------------
    // 10. JARVIS HOLOGRAPHIC CHASSIS UNDERGLOW
    // ------------------------------------------------------------------------
    const glowGeo = new THREE.PlaneGeometry(2.35, 4.60);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x00F0FF,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide
    });
    this.underglow = new THREE.Mesh(glowGeo, glowMat);
    this.underglow.rotation.x = -Math.PI / 2;
    this.underglow.position.y = 0.04;
    chassis.add(this.underglow);

    // Add fully assembled vehicle to MPU orientation root group
    this.proceduralChassis = chassis;
    this.carBody.add(chassis);
  }

  /**
   * Smooth wheel rotation and steering updates
   * driveState: 'STOP' / 0, 'FORWARD' / 1, 'BACKWARD' / 2
   * steerState: 'CENTER' / 0, 'LEFT' / 1, 'RIGHT' / 2
   */
  update(deltaTime, driveState, steerState, speed) {
    // 1. Front Steering Knuckles (Left / Right on Y axis)
    if (steerState === 1 || steerState === 'LEFT') {
      this.targetSteerAngle = 0.42; // Turn left ~24 deg
    } else if (steerState === 2 || steerState === 'RIGHT') {
      this.targetSteerAngle = -0.42; // Turn right ~24 deg
    } else {
      this.targetSteerAngle = 0;
    }

    this.currentSteerAngle += (this.targetSteerAngle - this.currentSteerAngle) * Math.min(1.0, deltaTime * 12.0);

    // Update procedural front knuckles
    if (this.flKnuckle && this.frKnuckle) {
      this.flKnuckle.rotation.y = this.currentSteerAngle;
      this.frKnuckle.rotation.y = this.currentSteerAngle;
    }

    // Update GLB model front steering knuckles
    if (this.glbSteerKnuckles && this.glbSteerKnuckles.length > 0) {
      for (let i = 0; i < this.glbSteerKnuckles.length; i++) {
        this.glbSteerKnuckles[i].rotation.y = this.currentSteerAngle;
      }
    }

    // 2. Wheel Axle Rolling (Pure X axis rotation - ZERO WOBBLE)
    // Wheels roll forward/backward strictly based on driveState!
    let rollVelocity = 0;
    const speedFactor = ((speed || 190) / 255.0) * 16.0;

    if (driveState === 1 || driveState === 'FORWARD') {
      rollVelocity = -speedFactor; // Roll forward
    } else if (driveState === 2 || driveState === 'BACKWARD') {
      rollVelocity = speedFactor;  // Roll backward
    }

    if (rollVelocity !== 0) {
      const deltaRoll = rollVelocity * deltaTime;
      // Procedural wheels
      for (let i = 0; i < this.rollingWheels.length; i++) {
        this.rollingWheels[i].rotation.x += deltaRoll;
      }
      // GLB wheels
      for (let i = 0; i < this.glbRollingAxles.length; i++) {
        this.glbRollingAxles[i].rotation.x += deltaRoll;
      }
    }
  }

  /**
   * DIRECT REAL-TIME MPU6050 ORIENTATION MAPPING
   * pitchDeg: Nose up/down (Tilt around X)
   * rollDeg:  Banking left/right (Tilt around Z)
   * yawDeg:   Heading (Turn around Y)
   */
  setOrientation(pitchDeg, rollDeg, yawDeg) {
    // Convert degrees to radians
    const pitchRad = THREE.MathUtils.degToRad(pitchDeg);
    const rollRad  = THREE.MathUtils.degToRad(rollDeg);
    const yawRad   = THREE.MathUtils.degToRad(yawDeg);

    // Apply via Euler with 'YXZ' order to eliminate gimbal coupling
    const euler = new THREE.Euler(pitchRad, -yawRad, -rollRad, 'YXZ');
    this.carBody.quaternion.setFromEuler(euler);
  }

  setEmergencyVisuals(active) {
    if (this.underglow) {
      this.underglow.material.color.setHex(active ? 0xFF1122 : 0x00F0FF);
    }
    for (let i = 0; i < this.headlights.length; i++) {
      if (this.headlights[i].material && this.headlights[i].material.emissive) {
        this.headlights[i].material.emissive.setHex(active ? 0xFF1122 : 0x00F0FF);
      }
    }
  }
}
