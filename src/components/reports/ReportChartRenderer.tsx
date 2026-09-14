import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts';

interface ReportChartRendererProps {
  chartType: 'bar' | 'pie' | 'line';
  data: Record<string, any>[];
  xAxisKey: string;
  yAxisKey: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

const PALETTE = [
  '#6A4DFF',
  '#10B981',
  '#F59E0B',
  '#06B6D4',
  '#EC4899',
  '#8B5CF6',
  '#3B82F6',
  '#14B8A6',
  '#F97316',
  '#84CC16',
];

export const ReportChartRenderer: React.FC<ReportChartRendererProps> = ({
  chartType,
  data,
  xAxisKey,
  yAxisKey,
  xAxisLabel,
  yAxisLabel,
}) => {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-500 text-xs italic bg-slate-900/50 rounded-2xl border border-slate-800">
        No dataset rows available to chart
      </div>
    );
  }

  // Format sample data for charts
  const chartData = data.slice(0, 30).map((row, idx) => {
    let xVal = row[xAxisKey];
    if (xVal === undefined || xVal === null) xVal = `Item ${idx + 1}`;
    let yVal = Number(row[yAxisKey]);
    if (isNaN(yVal)) yVal = 0;

    return {
      name: String(xVal),
      value: yVal,
    };
  });

  return (
    <div className="w-full h-80 bg-slate-900/90 border border-slate-800 rounded-3xl p-4 shadow-xl flex flex-col">
      <div className="flex items-center justify-between mb-3 px-2">
        <div className="text-xs font-bold text-slate-300 flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#6A4DFF]" />
          <span>
            {yAxisLabel || yAxisKey} by {xAxisLabel || xAxisKey}
          </span>
        </div>
        <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md">
          {chartType.toUpperCase()} VIEW
        </span>
      </div>

      <div className="w-full flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
              <XAxis
                dataKey="name"
                stroke="#94a3b8"
                fontSize={11}
                tickLine={false}
                interval={0}
                angle={-20}
                textAnchor="end"
              />
              <YAxis
                stroke="#94a3b8"
                fontSize={11}
                tickLine={false}
                tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '12px',
                  fontSize: '12px',
                  color: '#f8fafc',
                }}
                formatter={(val: any) => [
                  typeof val === 'number' ? val.toLocaleString() : val,
                  yAxisLabel || yAxisKey,
                ]}
              />
              <Bar dataKey="value" fill="#6A4DFF" radius={[6, 6, 0, 0]}>
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          ) : chartType === 'pie' ? (
            <PieChart>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '12px',
                  fontSize: '12px',
                  color: '#f8fafc',
                }}
                formatter={(val: any) => [
                  typeof val === 'number' ? val.toLocaleString() : val,
                  yAxisLabel || yAxisKey,
                ]}
              />
              <Legend
                formatter={(val) => <span className="text-slate-300 text-xs font-medium">{val}</span>}
              />
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={85}
                paddingAngle={4}
                dataKey="value"
                nameKey="name"
                label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
              >
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
              <XAxis
                dataKey="name"
                stroke="#94a3b8"
                fontSize={11}
                tickLine={false}
                interval={0}
                angle={-20}
                textAnchor="end"
              />
              <YAxis
                stroke="#94a3b8"
                fontSize={11}
                tickLine={false}
                tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '12px',
                  fontSize: '12px',
                  color: '#f8fafc',
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#6A4DFF"
                strokeWidth={3}
                dot={{ fill: '#10B981', r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
