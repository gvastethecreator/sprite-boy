declare module "gifshot" {
  interface GifshotOptions {
    images?: string[];
    gifWidth?: number;
    gifHeight?: number;
    interval?: number;
    numFrames?: number;
    frameDuration?: number;
    sampleInterval?: number;
    numWorkers?: number;
    progressCallback?: (progress: number) => void;
  }

  interface GifshotResult {
    error: boolean;
    errorCode?: string;
    errorMsg?: string;
    image?: string;
  }

  const gifshot: {
    createGIF(
      options: GifshotOptions,
      callback: (result: GifshotResult) => void,
    ): void;
  };

  export default gifshot;
}
