import { DicomImage } from '../types';
import { ColorMaps, ColormapType } from './ColorMaps';

export class ImageRenderer {
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;
  private cachedImageData: ImageData | null = null;
  private lastRenderParams: string = '';

  constructor() {
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  /**
   * 渲染 DICOM 影像至离屏画布并返回 (带尺寸与窗宽窗位缓存)
   */
  renderToCanvas(
    image: DicomImage,
    windowCenter: number,
    windowWidth: number,
    invert: boolean = false,
    colormap: ColormapType = 'grayscale'
  ): HTMLCanvasElement {
    const { width, height } = image;

    if (this.offscreenCanvas.width !== width || this.offscreenCanvas.height !== height) {
      this.offscreenCanvas.width = width;
      this.offscreenCanvas.height = height;
      this.cachedImageData = this.offscreenCtx.createImageData(width, height);
    }

    const paramKey = `${image.id}_${windowCenter}_${windowWidth}_${invert}_${colormap}`;
    if (paramKey === this.lastRenderParams && this.cachedImageData) {
      return this.offscreenCanvas;
    }

    const imgData = this.cachedImageData || this.offscreenCtx.createImageData(width, height);
    const rgba = imgData.data;
    const pixelData = image.pixelData;
    const { rescaleSlope, rescaleIntercept } = image.metadata;
    const lut = ColorMaps.getLut(colormap);

    const halfWidth = Math.max(1, windowWidth) / 2;
    const minVal = windowCenter - halfWidth;
    const factor = 255.0 / Math.max(1, windowWidth);
    const numPixels = width * height;
    // MONOCHROME1 的灰度语义与 MONOCHROME2 相反，需要叠加一次反相
    const isMonochrome1 = String(image.metadata.photometricInterpretation).toUpperCase() === 'MONOCHROME1';
    const shouldInvert = invert !== isMonochrome1;

    for (let i = 0; i < numPixels; i++) {
      const raw = pixelData[i];
      // 计算 Hounsfield Unit (HU)
      const hu = raw * rescaleSlope + rescaleIntercept;

      // 窗宽窗位线性映射至 [0, 255]
      let val = Math.round((hu - minVal) * factor);
      if (val < 0) val = 0;
      else if (val > 255) val = 255;

      if (shouldInvert) {
        val = 255 - val;
      }

      const lutOffset = val * 4;
      const pixelOffset = i * 4;

      rgba[pixelOffset] = lut[lutOffset];
      rgba[pixelOffset + 1] = lut[lutOffset + 1];
      rgba[pixelOffset + 2] = lut[lutOffset + 2];
      rgba[pixelOffset + 3] = 255;
    }

    this.offscreenCtx.putImageData(imgData, 0, 0);
    this.lastRenderParams = paramKey;

    return this.offscreenCanvas;
  }

  /**
   * 获取指定图像坐标 (x, y) 的精确 Hounsfield Unit (HU) 值或原始值
   */
  static getPixelHU(image: DicomImage, x: number, y: number): { hu: number; raw: number; inBounds: boolean } {
    const ix = Math.floor(x);
    const iy = Math.floor(y);

    if (ix < 0 || ix >= image.width || iy < 0 || iy >= image.height) {
      return { hu: 0, raw: 0, inBounds: false };
    }

    const idx = iy * image.width + ix;
    const raw = image.pixelData[idx];
    const hu = Math.round(raw * image.metadata.rescaleSlope + image.metadata.rescaleIntercept);

    return { hu, raw, inBounds: true };
  }
}
