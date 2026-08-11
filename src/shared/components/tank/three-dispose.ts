import type * as THREE from "three";

/**
 * Free every geometry and material under `root`.
 *
 * R3F disposes only the objects it constructs from JSX — never a
 * `<primitive>` payload, and never anything built imperatively. Everything in
 * the 3D tank (fish meshes, plants, rocks) is built imperatively, so without
 * an explicit sweep on unmount each one leaks its GPU buffers.
 *
 * Textures are deliberately NOT disposed here. Every texture in the tank is
 * owned by a ref-counted cache and shared between look-alike fish — freeing
 * one from a single owner's teardown would pull the map out from under the
 * others. Release those through their own cache instead (`releaseSkin`).
 */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) m.dispose();
  });
}
