declare module "js-yaml" {
  interface DumpOptions {
    noRefs?: boolean;
    lineWidth?: number;
    sortKeys?: boolean;
  }

  interface JsYamlModule {
    dump(input: unknown, options?: DumpOptions): string;
    load(input: string): unknown;
  }

  const yaml: JsYamlModule;
  export default yaml;
}
