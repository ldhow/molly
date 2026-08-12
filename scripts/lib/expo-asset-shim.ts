export class Asset {
  static fromModule(_moduleId: unknown) {
    return new Asset();
  }
  localUri = "/short_molly.glb";
  uri = "/short_molly.glb";
  async downloadAsync() {
    return this;
  }
}
