import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import type { GalleryProject } from './GalleryScene';

export const PANEL_W = 4.4;
export const PANEL_H = 2.7;

function roundedPlaneGeometry(w: number, h: number, r: number) {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x, y + r);
  shape.lineTo(x, y + h - r);
  shape.quadraticCurveTo(x, y + h, x + r, y + h);
  shape.lineTo(x + w - r, y + h);
  shape.quadraticCurveTo(x + w, y + h, x + w, y + h - r);
  shape.lineTo(x + w, y + r);
  shape.quadraticCurveTo(x + w, y, x + w - r, y);
  shape.lineTo(x + r, y);
  shape.quadraticCurveTo(x, y, x, y + r);
  return new THREE.ShapeGeometry(shape, 8);
}

// Shared module-level geometries (panels are all the same size).
const faceGeometry = roundedPlaneGeometry(PANEL_W, PANEL_H, 0.18);
const glowGeometry = roundedPlaneGeometry(PANEL_W + 0.22, PANEL_H + 0.22, 0.24);

const STATUS_LABEL: Record<string, string> = {
  public: 'Open source',
  private: 'Private · demo on request',
  soon: 'Coming soon',
};

export interface ProjectPanelProps {
  project: GalleryProject;
  position: [number, number, number];
  /** A point on the flight path the panel should initially face (where the camera approaches from). */
  approach: [number, number, number];
  index: number;
}

export default function ProjectPanel({ project, position, approach, index }: ProjectPanelProps) {
  const group = useRef<THREE.Group>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const faceMat = useRef<THREE.MeshStandardMaterial>(null);
  const [hovered, setHovered] = useState(false);

  const tmp = useMemo(
    () => ({
      obj: new THREE.Object3D(),
      tilt: new THREE.Quaternion(),
      euler: new THREE.Euler(),
      scale: new THREE.Vector3(),
    }),
    []
  );

  const accent = project.featured ? '#ec4899' : '#8b5cf6';
  const summary =
    project.summary.length > 150
      ? project.summary.slice(0, 147).trimEnd() + '…'
      : project.summary;

  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    g.position.set(position[0], position[1], position[2]);
    g.lookAt(approach[0], approach[1], approach[2]);
  }, [position, approach]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
    };
  }, []);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;

    // Gentle bob so panels feel like they float.
    g.position.y =
      position[1] + Math.sin(state.clock.elapsedTime * 0.8 + index * 1.7) * 0.07;

    // Damped "face the camera" + subtle mouse-parallax tilt.
    tmp.obj.position.copy(g.position);
    tmp.obj.lookAt(state.camera.position);
    tmp.euler.set(-state.pointer.y * 0.1, state.pointer.x * 0.14, 0);
    tmp.tilt.setFromEuler(tmp.euler);
    tmp.obj.quaternion.multiply(tmp.tilt);
    g.quaternion.slerp(tmp.obj.quaternion, 1 - Math.pow(0.001, delta));

    // Hover: scale + glow.
    g.scale.lerp(tmp.scale.setScalar(hovered ? 1.07 : 1), 1 - Math.pow(0.002, delta));
    if (glowMat.current) {
      glowMat.current.opacity = THREE.MathUtils.lerp(
        glowMat.current.opacity,
        hovered ? 0.55 : 0.16,
        0.12
      );
    }
    if (faceMat.current) {
      faceMat.current.emissiveIntensity = THREE.MathUtils.lerp(
        faceMat.current.emissiveIntensity,
        hovered ? 0.75 : 0.22,
        0.12
      );
    }
  });

  return (
    <group
      ref={group}
      onClick={(e) => {
        e.stopPropagation();
        window.location.href = `/projects/${project.id}/`;
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = '';
      }}
    >
      {/* Neon glow frame */}
      <mesh geometry={glowGeometry} position={[0, 0, -0.03]}>
        <meshBasicMaterial
          ref={glowMat}
          color={accent}
          transparent
          opacity={0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Panel face */}
      <mesh geometry={faceGeometry}>
        <meshStandardMaterial
          ref={faceMat}
          color="#171030"
          emissive="#6d28d9"
          emissiveIntensity={0.22}
          roughness={0.4}
          metalness={0.25}
          side={THREE.DoubleSide}
          transparent
          opacity={0.96}
        />
      </mesh>

      {/* Content */}
      {project.featured && (
        <Text
          position={[PANEL_W / 2 - 0.32, 1.02, 0.02]}
          fontSize={0.11}
          letterSpacing={0.18}
          color="#fb7185"
          anchorX="right"
          anchorY="middle"
        >
          FEATURED
        </Text>
      )}
      <Text
        position={[-PANEL_W / 2 + 0.35, 0.9, 0.02]}
        fontSize={0.3}
        color="#f5f0ff"
        anchorX="left"
        anchorY="middle"
        maxWidth={PANEL_W - 0.7}
      >
        {project.title}
      </Text>
      <Text
        position={[-PANEL_W / 2 + 0.35, 0.58, 0.02]}
        fontSize={0.135}
        color="#67e8f9"
        anchorX="left"
        anchorY="middle"
        maxWidth={PANEL_W - 0.7}
      >
        {project.tech.join(' · ')}
      </Text>
      <Text
        position={[-PANEL_W / 2 + 0.35, 0.34, 0.02]}
        fontSize={0.155}
        lineHeight={1.45}
        color="#beb3e6"
        anchorX="left"
        anchorY="top"
        maxWidth={PANEL_W - 0.7}
      >
        {summary}
      </Text>
      <Text
        position={[-PANEL_W / 2 + 0.35, -PANEL_H / 2 + 0.32, 0.02]}
        fontSize={0.125}
        color="#f0abfc"
        anchorX="left"
        anchorY="middle"
      >
        {STATUS_LABEL[project.status] ?? project.status}
      </Text>
      <Text
        position={[PANEL_W / 2 - 0.35, -PANEL_H / 2 + 0.32, 0.02]}
        fontSize={0.135}
        color="#22d3ee"
        anchorX="right"
        anchorY="middle"
      >
        open →
      </Text>
    </group>
  );
}
