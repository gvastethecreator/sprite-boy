export const MODEL_CATALOG_SCHEMA_VERSION = 1 as const;

export const LOCAL_MODEL_IDS = Object.freeze([
  "birefnet-lite-512",
  "ben2-base",
  "rmbg-2.0",
] as const);

export type LocalModelId = typeof LOCAL_MODEL_IDS[number];
export type ModelDigestAlgorithm = "sha256" | "git-sha1";
export type ModelBackend = "webgpu" | "wasm";

export interface ModelFileDigest {
  readonly algorithm: ModelDigestAlgorithm;
  readonly value: string;
}

export interface ModelFileSpec {
  readonly path: string;
  readonly byteSize: number;
  readonly digest: ModelFileDigest;
  readonly downloadUrl: string;
}

export interface LocalModelDefinition {
  readonly schemaVersion: typeof MODEL_CATALOG_SCHEMA_VERSION;
  readonly id: LocalModelId;
  readonly label: string;
  readonly repositoryId: string;
  readonly revision: string;
  readonly gated: boolean;
  readonly license: {
    readonly id: string;
    readonly name: string;
    readonly use: "permissive" | "non-commercial";
    readonly url: string;
    readonly acceptanceUrl: string | null;
  };
  readonly runtime: {
    readonly task: "image-segmentation";
    readonly dtype: "fp16" | "fp32" | "q4f16";
    readonly inputWidth: number;
    readonly inputHeight: number;
    readonly preferredBackends: readonly ModelBackend[];
    readonly minimumMemoryBytes: number;
    readonly inputNormalization: "imagenet" | "zero-one";
    readonly outputNormalization: "min-max" | "sigmoid";
    readonly outputType: "float16" | "float32";
    readonly inputName: string | null;
    readonly outputName: string | null;
  };
  readonly files: readonly ModelFileSpec[];
}

function pinnedUrl(repositoryId: string, revision: string, path: string): string {
  return `https://huggingface.co/${repositoryId}/resolve/${revision}/${path}`;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const BIREFNET_REVISION = "4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7";
const BEN2_REVISION = "e48a20765fb421d19dcdb0bf3cc61e802ca5ec8f";
const RMBG_REVISION = "5df4c9c76d8170882c34f6986e848ee07fd0ba43";

export const LOCAL_MODEL_CATALOG: Readonly<Record<LocalModelId, LocalModelDefinition>> = deepFreeze({
  "birefnet-lite-512": {
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    id: "birefnet-lite-512",
    label: "BiRefNet Lite 512",
    repositoryId: "studioludens/birefnet-lite-512",
    revision: BIREFNET_REVISION,
    gated: false,
    license: {
      id: "MIT",
      name: "MIT License",
      use: "permissive",
      url: "https://huggingface.co/studioludens/birefnet-lite-512/blob/main/README.md",
      acceptanceUrl: null,
    },
    runtime: {
      task: "image-segmentation",
      dtype: "fp16",
      inputWidth: 512,
      inputHeight: 512,
      preferredBackends: ["webgpu", "wasm"],
      minimumMemoryBytes: 1_073_741_824,
      inputNormalization: "imagenet",
      outputNormalization: "sigmoid",
      outputType: "float32",
      inputName: "input_image",
      outputName: "output_image",
    },
    files: [
      {
        path: "config.json",
        byteSize: 81,
        digest: {
          algorithm: "sha256",
          value: "561965f7aa366c48b95ab1c24220d59a718df4025c2ecb359dd5736ceb49e912",
        },
        downloadUrl: pinnedUrl("studioludens/birefnet-lite-512", BIREFNET_REVISION, "config.json"),
      },
      {
        path: "preprocessor_config.json",
        byteSize: 389,
        digest: {
          algorithm: "sha256",
          value: "a79663b311d8404dfb329f7b45bc9f970a0c155aeedae8ac15b6b77d76789613",
        },
        downloadUrl: pinnedUrl(
          "studioludens/birefnet-lite-512",
          BIREFNET_REVISION,
          "preprocessor_config.json",
        ),
      },
      {
        path: "onnx/model_fp16.onnx",
        byteSize: 98_484_532,
        digest: {
          algorithm: "sha256",
          value: "eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516",
        },
        downloadUrl: pinnedUrl(
          "studioludens/birefnet-lite-512",
          BIREFNET_REVISION,
          "onnx/model_fp16.onnx",
        ),
      },
    ],
  },
  "ben2-base": {
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    id: "ben2-base",
    label: "BEN2 Base",
    repositoryId: "PramaLLC/BEN2",
    revision: BEN2_REVISION,
    gated: false,
    license: {
      id: "MIT",
      name: "MIT License",
      use: "permissive",
      url: "https://huggingface.co/PramaLLC/BEN2",
      acceptanceUrl: null,
    },
    runtime: {
      task: "image-segmentation",
      dtype: "fp32",
      inputWidth: 1024,
      inputHeight: 1024,
      preferredBackends: ["webgpu", "wasm"],
      minimumMemoryBytes: 4_831_838_208,
      inputNormalization: "zero-one",
      outputNormalization: "min-max",
      outputType: "float16",
      inputName: "input.1",
      outputName: "17728",
    },
    files: [
      {
        path: "ben2-base.onnx",
        byteSize: 222_932_053,
        digest: {
          algorithm: "sha256",
          value: "22cea62108ff53b7ccc20f7a008bf30494228d84b1687f29ecbe76936a998101",
        },
        downloadUrl: pinnedUrl("PramaLLC/BEN2", BEN2_REVISION, "BEN2_Base.onnx"),
      },
    ],
  },
  "rmbg-2.0": {
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    id: "rmbg-2.0",
    label: "RMBG 2.0",
    repositoryId: "briaai/RMBG-2.0",
    revision: RMBG_REVISION,
    gated: true,
    license: {
      id: "bria-rmbg-2.0",
      name: "CC BY-NC 4.0 for non-commercial use",
      use: "non-commercial",
      url: "https://huggingface.co/briaai/RMBG-2.0",
      acceptanceUrl: "https://huggingface.co/briaai/RMBG-2.0",
    },
    runtime: {
      task: "image-segmentation",
      dtype: "q4f16",
      inputWidth: 1024,
      inputHeight: 1024,
      preferredBackends: ["webgpu"],
      minimumMemoryBytes: 2_147_483_648,
      inputNormalization: "imagenet",
      outputNormalization: "sigmoid",
      outputType: "float32",
      inputName: null,
      outputName: null,
    },
    files: [
      {
        path: "config.json",
        byteSize: 405,
        digest: {
          algorithm: "git-sha1",
          value: "06d8fa9d7f2f4c6f1cf0dc6e7bfd194153176a42",
        },
        downloadUrl: pinnedUrl("briaai/RMBG-2.0", RMBG_REVISION, "config.json"),
      },
      {
        path: "preprocessor_config.json",
        byteSize: 391,
        digest: {
          algorithm: "git-sha1",
          value: "825398cfd94a348babce456f2bcc8422c9bebb93",
        },
        downloadUrl: pinnedUrl("briaai/RMBG-2.0", RMBG_REVISION, "preprocessor_config.json"),
      },
      {
        path: "onnx/model_q4f16.onnx",
        byteSize: 233_815_293,
        digest: {
          algorithm: "sha256",
          value: "8bfeb5f93220eb19f6747c217b62cf04342840c4e973f55bf64e9762919f446d",
        },
        downloadUrl: pinnedUrl("briaai/RMBG-2.0", RMBG_REVISION, "onnx/model_q4f16.onnx"),
      },
    ],
  },
});

export function isLocalModelId(value: string): value is LocalModelId {
  return Object.hasOwn(LOCAL_MODEL_CATALOG, value);
}

export function getLocalModelDefinition(id: LocalModelId): LocalModelDefinition {
  return LOCAL_MODEL_CATALOG[id];
}

export function modelInstallByteSize(model: LocalModelDefinition): number {
  return model.files.reduce((total, file) => total + file.byteSize, 0);
}

export function modelCatalogFingerprint(model: LocalModelDefinition): string {
  const runtime = [
    model.runtime.task,
    model.runtime.dtype,
    `${model.runtime.inputWidth}x${model.runtime.inputHeight}`,
    model.runtime.preferredBackends.join(","),
    model.runtime.minimumMemoryBytes,
    model.runtime.inputNormalization,
    model.runtime.outputNormalization,
    model.runtime.outputType,
    model.runtime.inputName ?? "auto",
    model.runtime.outputName ?? "auto",
  ].join(":");
  const files = model.files
    .map((file) => `${file.path}:${file.byteSize}:${file.digest.algorithm}:${file.digest.value}`)
    .join("|");
  return `${MODEL_CATALOG_SCHEMA_VERSION}:${model.id}:${model.revision}:${runtime}:${files}`;
}
