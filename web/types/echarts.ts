import { CallbackDataParams } from 'echarts/types/dist/shared.js';

export interface ToolTipFormatterParams extends CallbackDataParams {
  axisDim: string;
  axisIndex: number;
  axisType: string;
  axisId: string;
  axisValue: string;
  axisValueLabel: string;
}
