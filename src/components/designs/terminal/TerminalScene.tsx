import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Retro-terminal hero scene: an endless phosphor-green wireframe terrain
 * flying toward the camera, with mouse parallax steering, a wheel-driven
 * speed boost, and a "BOOT" dive triggered by clicking the terrain or by a
 * `terminal-boot` CustomEvent dispatched from the page (the BOOT button).
 * Respects prefers-reduced-motion: renders a single static frame.
 */

const BG = '#020604';
const GRID = '#33ff66';
const GRID_DIM = '#0e5c2c';

function terrainHeight(x: number, z: number): number {
  // Layered sines make cheap, stable "noise"; the valley term flattens a
  // corridor down the middle so the camera flies through a canyon.
  const ridge =
    Math.sin(x * 0.16 + z * 0.21) * 1.1 +
    Math.sin(x * 0.31 - z * 0.14) * 0.6 +
    Math.sin(x * 0.05 + z * 0.08) * 1.9 +
    Math.sin(x * 0.7 + z * 0.53) * 0.18;
  const valley = Math.min(1, Math.pow(Math.abs(x) / 10, 1.6));
  return ridge * valley * 1.5;
}

interface FlightState {
  pointer: { x: number; y: number };
  wheelBoost: number;
  diveAt: number; // clock time the last dive started, -Infinity if none
  offset: number;
}

function Terrain({ flight, reduced }: { flight: FlightState; reduced: boolean }) {
  const { geometry, baseX, baseZ } = useMemo(() => {
    const g = new THREE.PlaneGeometry(120, 80, 96, 72);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -24);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    const bx = new Float32Array(n);
    const bz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      bx[i] = pos.getX(i);
      bz[i] = pos.getZ(i);
      pos.setY(i, terrainHeight(bx[i], bz[i]));
    }
    pos.needsUpdate = true;
    return { geometry: g, baseX: bx, baseZ: bz };
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state, delta) => {
    if (reduced) return;
    const dt = Math.min(delta, 0.1);

    // Dive envelope: 0 -> 1 -> 0 over ~2.4s after a boot trigger.
    const t = state.clock.elapsedTime - flight.diveAt;
    const dive = t >= 0 && t < 2.4 ? Math.sin((t / 2.4) * Math.PI) : 0;

    flight.wheelBoost *= Math.exp(-dt * 1.6);
    const speed = 7 + flight.wheelBoost * 18 + dive * 34;
    flight.offset += speed * dt;

    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      // y is component 1 of each vec3
      arr[i * 3 + 1] = terrainHeight(baseX[i], baseZ[i] - flight.offset);
    }
    pos.needsUpdate = true;
  });

  return (
    <group>
      {/* Solid under-layer occludes far grid lines so the mesh reads as ground */}
      <mesh geometry={geometry}>
        <meshBasicMaterial color={BG} polygonOffset polygonOffsetFactor={2} polygonOffsetUnits={2} />
      </mesh>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={GRID} wireframe transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

function Stars({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const count = 260;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      // Upper dome only
      const phi = Math.random() * Math.PI * 0.42;
      const r = 65;
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = 6 + r * Math.cos(phi) * 0.5;
      arr[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) - 20;
    }
    return arr;
  }, []);

  useFrame((state) => {
    if (reduced || !ref.current) return;
    ref.current.rotation.y = state.clock.elapsedTime * 0.004;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.35} color={GRID_DIM} transparent opacity={0.9} sizeAttenuation />
    </points>
  );
}

function CameraRig({ flight, reduced }: { flight: FlightState; reduced: boolean }) {
  useFrame((state) => {
    if (reduced) return;
    const cam = state.camera as THREE.PerspectiveCamera;
    const t = state.clock.elapsedTime - flight.diveAt;
    const dive = t >= 0 && t < 2.4 ? Math.sin((t / 2.4) * Math.PI) : 0;

    const targetX = flight.pointer.x * 3.2;
    const targetY = 3.4 - flight.pointer.y * 0.9 - dive * 1.7;
    cam.position.x += (targetX - cam.position.x) * 0.05;
    cam.position.y += (targetY - cam.position.y) * 0.06;

    cam.lookAt(cam.position.x * 0.55, 1.3 - dive * 1.1, cam.position.z - 14);
    // Bank into the turn (local roll applied after lookAt)
    cam.rotateZ(-flight.pointer.x * 0.07);

    const targetFov = 60 + dive * 16 + Math.min(flight.wheelBoost, 1.2) * 7;
    if (Math.abs(cam.fov - targetFov) > 0.01) {
      cam.fov += (targetFov - cam.fov) * 0.1;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

/** Bridges window-level events (pointer, wheel, BOOT button) into the scene. */
function EventBridge({ flight, reduced }: { flight: FlightState; reduced: boolean }) {
  const clock = useThree((s) => s.clock);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    if (reduced) return;
    const onMove = (e: PointerEvent) => {
      flight.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      flight.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const onWheel = (e: WheelEvent) => {
      const kick = (Math.min(Math.abs(e.deltaY), 120) / 120) * 0.35;
      flight.wheelBoost = Math.min(flight.wheelBoost + kick, 1.4);
    };
    const onBoot = () => {
      flight.diveAt = clock.elapsedTime;
    };
    const canvas = gl.domElement;
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('terminal-boot', onBoot);
    // Clicking the terrain itself also triggers a dive.
    canvas.addEventListener('pointerdown', onBoot);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('terminal-boot', onBoot);
      canvas.removeEventListener('pointerdown', onBoot);
    };
  }, [flight, reduced, clock, gl]);

  return null;
}

export default function TerminalScene() {
  const reduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  const flight = useRef<FlightState>({
    pointer: { x: 0, y: 0 },
    wheelBoost: 0,
    diveAt: -Infinity,
    offset: 0,
  }).current;

  return (
    <Canvas
      camera={{ position: [0, 3.4, 9], fov: 60, near: 0.1, far: 160 }}
      dpr={[1, 2]}
      frameloop={reduced ? 'demand' : 'always'}
      style={{ width: '100%', height: '100%' }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 14, 62]} />
      <Terrain flight={flight} reduced={reduced} />
      <Stars reduced={reduced} />
      <CameraRig flight={flight} reduced={reduced} />
      <EventBridge flight={flight} reduced={reduced} />
    </Canvas>
  );
}
