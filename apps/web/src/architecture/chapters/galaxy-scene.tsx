'use client';

// The galaxy's WebGL scene, code-split from the rest of /architecture: three.js
// loads only when chapter 9 mounts (P09c decision 5). One draw call for every
// point; colour, alpha and size are per-vertex attributes, so highlighting a
// persona or a search never rebuilds the geometry.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GalaxyPoint } from '../data/galaxy';

/** The camera distance at which a point's size attribute is its size in pixels. */
export const REFERENCE_DISTANCE = 1.9;

const VERTEX = /* glsl */ `
  attribute vec3 color;
  attribute float alpha;
  attribute float size;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float scale;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    // A solid disc with a soft rim, plus a faint glow toward the centre.
    float disc = 1.0 - smoothstep(0.32, 0.5, d);
    float glow = 0.35 * (1.0 - smoothstep(0.0, 0.32, d));
    gl_FragColor = vec4(vColor + glow, vAlpha * disc);
  }
`;

function Controls({ rotate }: { rotate: boolean }) {
  const { camera, gl } = useThree();
  const ref = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.enablePan = false;
    // The wheel scrolls the page, never the scene: zoom is on the buttons.
    c.enableZoom = false;
    c.autoRotateSpeed = 0.5;
    ref.current = c;
    return () => {
      c.dispose();
    };
  }, [camera, gl]);
  useEffect(() => {
    if (ref.current) ref.current.autoRotate = rotate;
  }, [rotate]);
  useFrame(() => ref.current?.update());
  return null;
}

function Zoom({ distance }: { distance: number }) {
  const { camera } = useThree();
  useFrame(() => {
    const len = camera.position.length();
    const next = len + (distance - len) * 0.12;
    if (Math.abs(next - len) > 1e-4) camera.position.multiplyScalar(next / len);
  });
  return null;
}

function Cloud({
  points,
  colors,
  alphas,
  sizes,
  additive,
  onHover,
  onPick,
}: {
  points: readonly GalaxyPoint[];
  colors: Float32Array;
  alphas: Float32Array;
  sizes: Float32Array;
  additive: boolean;
  onHover: (i: number | null, e?: ThreeEvent<PointerEvent>) => void;
  onPick: (i: number) => void;
}) {
  const { size: viewport, gl } = useThree();
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        points.flatMap((p) => [p.x, p.y, p.z]),
        3,
      ),
    );
    return g;
  }, [points]);
  useEffect(() => {
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  }, [geometry, colors, alphas, sizes]);
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { scale: { value: 1 } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => {
    material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    material.needsUpdate = true;
  }, [material, additive]);
  // Sizes are pixels at the reference distance on a 460 px tall canvas; they
  // scale with the device pixel ratio, the canvas height and 1 / depth.
  useEffect(() => {
    material.uniforms.scale = {
      value: gl.getPixelRatio() * (viewport.height / 460) * REFERENCE_DISTANCE,
    };
  }, [material, gl, viewport.height]);
  useEffect(
    () => () => {
      material.dispose();
    },
    [material],
  );
  return (
    <points
      geometry={geometry}
      material={material}
      onPointerMove={(e) => {
        e.stopPropagation();
        onHover(e.index ?? null, e);
      }}
      onPointerOut={() => {
        onHover(null);
      }}
      onClick={(e) => {
        if (e.index !== undefined) onPick(e.index);
      }}
    />
  );
}

export interface SceneProps {
  points: readonly GalaxyPoint[];
  colors: Float32Array;
  alphas: Float32Array;
  sizes: Float32Array;
  additive: boolean;
  rotate: boolean;
  running: boolean;
  distance: number;
  onHover: (i: number | null, client?: { x: number; y: number }) => void;
  onPick: (i: number) => void;
}

export default function GalaxyScene(props: SceneProps) {
  return (
    <Canvas
      frameloop={props.running ? 'always' : 'never'}
      dpr={[1, 2]}
      // The projection is longest along z, so the camera starts side-on to it.
      camera={{ position: [props.distance, 0.25, 0.35], fov: 45, near: 0.05, far: 50 }}
      raycaster={{ params: { Points: { threshold: 0.025 } } as THREE.RaycasterParameters }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
    >
      <Controls rotate={props.rotate} />
      <Zoom distance={props.distance} />
      <Cloud
        points={props.points}
        colors={props.colors}
        alphas={props.alphas}
        sizes={props.sizes}
        additive={props.additive}
        onHover={(i, e) => {
          props.onHover(i, e ? { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } : undefined);
        }}
        onPick={props.onPick}
      />
    </Canvas>
  );
}
