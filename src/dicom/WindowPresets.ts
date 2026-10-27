import { PresetWindowLevel } from '../types';

export const DEFAULT_WINDOW_PRESETS: PresetWindowLevel[] = [
  {
    name: 'Brain',
    nameZh: '颅脑 (Brain)',
    windowCenter: 40,
    windowWidth: 80,
    modality: 'CT'
  },
  {
    name: 'Bone',
    nameZh: '骨窗 (Bone)',
    windowCenter: 500,
    windowWidth: 2000,
    modality: 'CT'
  },
  {
    name: 'Lung',
    nameZh: '肺窗 (Lung)',
    windowCenter: -600,
    windowWidth: 1500,
    modality: 'CT'
  },
  {
    name: 'Mediastinum',
    nameZh: '纵隔/软组织 (Soft Tissue)',
    windowCenter: 40,
    windowWidth: 350,
    modality: 'CT'
  },
  {
    name: 'Liver',
    nameZh: '腹部/肝脏 (Liver)',
    windowCenter: 50,
    windowWidth: 150,
    modality: 'CT'
  },
  {
    name: 'Subdural',
    nameZh: '硬膜下 (Subdural)',
    windowCenter: 75,
    windowWidth: 150,
    modality: 'CT'
  },
  {
    name: 'Spine',
    nameZh: '脊椎 (Spine)',
    windowCenter: 60,
    windowWidth: 300,
    modality: 'CT'
  },
  {
    name: 'Angio',
    nameZh: '血管造影 (Angio)',
    windowCenter: 300,
    windowWidth: 600,
    modality: 'CT'
  }
];
