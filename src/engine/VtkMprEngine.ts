import vtkFullScreenRenderWindow from '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { DicomImage } from '../types';

export class VtkMprEngine {
  private container: HTMLElement;
  private fullScreenRenderer: any = null;
  private volume: any = null;
  private mapper: any = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * 将输入的连续 DICOM 切片重组为 VTK 3D ImageData 容积并进行三维体绘制
   */
  loadVolumeData(images: DicomImage[]): void {
    if (images.length === 0) return;
    this.container.innerHTML = '';

    const first = images[0];
    const width = first.width;
    const height = first.height;
    const depth = images.length;
    const spacing = first.metadata.pixelSpacing || [1, 1];
    const sliceThickness = first.metadata.sliceThickness || 3.0;

    // 1. 创建 VTK ImageData 3D 标量场
    const imageData = vtkImageData.newInstance();
    imageData.setDimensions([width, height, depth]);
    imageData.setSpacing([spacing[1], spacing[0], sliceThickness]);

    // 2. 组装所有切片的像素标量值 (扁平一维数组)
    const totalPixels = width * height * depth;
    const scalars = new Float32Array(totalPixels);
    const { rescaleSlope, rescaleIntercept } = first.metadata;

    for (let z = 0; z < depth; z++) {
      const slice = images[z];
      const sliceOffset = z * (width * height);
      const pixelData = slice.pixelData;

      for (let i = 0; i < width * height; i++) {
        const raw = pixelData[i];
        // 转换为真实 Hounsfield Unit (HU)
        scalars[sliceOffset + i] = raw * rescaleSlope + rescaleIntercept;
      }
    }

    const dataArray = vtkDataArray.newInstance({
      name: 'HU_Scalars',
      values: scalars,
      numberOfComponents: 1
    });

    imageData.getPointData().setScalars(dataArray);

    // 3. 初始化 VTK 渲染窗口
    this.fullScreenRenderer = vtkFullScreenRenderWindow.newInstance({
      container: this.container,
      containerStyle: { width: '100%', height: '100%', position: 'relative' },
      background: [0.04, 0.06, 0.1]
    } as any);

    const renderer = this.fullScreenRenderer.getRenderer();
    const renderWindow = this.fullScreenRenderer.getRenderWindow();

    // 4. 创建体绘制映射器 (Volume Mapper)
    this.mapper = vtkVolumeMapper.newInstance();
    this.mapper.setInputData(imageData);
    this.mapper.setSampleDistance(1.0);

    // 5. 设置临床 CT 标准传输函数 (Transfer Function: 骨骼高亮 + 软组织半透明)
    this.volume = vtkVolume.newInstance();
    this.volume.setMapper(this.mapper);

    // 颜色传递函数 (HU -> RGB)
    const ctColor = vtkColorTransferFunction.newInstance();
    ctColor.addRGBPoint(-1000, 0.0, 0.0, 0.0);   // 空气: 黑
    ctColor.addRGBPoint(-100, 0.6, 0.4, 0.2);    // 脂肪: 浅黄
    ctColor.addRGBPoint(40, 0.8, 0.3, 0.3);      // 软组织: 肉红
    ctColor.addRGBPoint(300, 0.9, 0.8, 0.7);     // 软松质骨
    ctColor.addRGBPoint(1200, 1.0, 1.0, 1.0);    // 密质高密度颅骨: 亮白

    // 不透明度传递函数 (HU -> Opacity)
    const ctOpacity = vtkPiecewiseFunction.newInstance();
    ctOpacity.addPoint(-1000, 0.0);
    ctOpacity.addPoint(-50, 0.0);
    ctOpacity.addPoint(40, 0.08); // 软组织低不透明度
    ctOpacity.addPoint(200, 0.3);
    ctOpacity.addPoint(800, 0.85); // 骨骼高不透明度
    ctOpacity.addPoint(1500, 1.0);

    this.volume.getProperty().setRGBTransferFunction(0, ctColor);
    this.volume.getProperty().setScalarOpacity(0, ctOpacity);
    this.volume.getProperty().setInterpolationTypeToLinear();
    this.volume.getProperty().setShade(true);
    this.volume.getProperty().setAmbient(0.2);
    this.volume.getProperty().setDiffuse(0.7);
    this.volume.getProperty().setSpecular(0.3);

    renderer.addVolume(this.volume);
    renderer.resetCamera();
    renderWindow.render();
  }

  /**
   * 销毁 VTK 实例与 WebGL 上下文
   */
  destroy(): void {
    if (this.fullScreenRenderer) {
      this.fullScreenRenderer.delete();
      this.fullScreenRenderer = null;
    }
  }
}
