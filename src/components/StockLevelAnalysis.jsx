import React, { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { fetchCalendarData } from '../data/scheduleData';

const StockLevelAnalysis = ({ data }) => {
  const [calendarData, setCalendarData] = useState({});
  const [loading, setLoading] = useState(true);

  // =============== 可配置：图表日期范围（横坐标） ===============
  // 默认：从今天到“下一年3月末”（保持你之前的默认体验）
  const today = useMemo(() => new Date(), []);
  const defaultEnd = useMemo(() => {
    const y = today.getFullYear();
    const m = today.getMonth(); // 0-based
    const targetYear = (m > 2) ? y + 1 : y;  // 若已过3月，取下一年
    return new Date(targetYear, 2, 31);      // 3月=2（0-based）
  }, [today]);

  const ymd = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  const parseYYYYMMDD = (s) => {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };
  const parseDDMMYYYY = (ddmmyyyy) => {
    const parts = String(ddmmyyyy || '').split('/');
    if (parts.length !== 3) return null;
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (Number.isNaN(d) || Number.isNaN(m) || Number.isNaN(y)) return null;
    return new Date(y, m - 1, d);
  };

  const [chartStartStr, setChartStartStr] = useState(ymd(today));
  const [chartEndStr, setChartEndStr] = useState(ymd(defaultEnd));

  const chartStartDate = useMemo(() => parseYYYYMMDD(chartStartStr) || today, [chartStartStr, today]);
  const chartEndDate   = useMemo(() => {
    const d = parseYYYYMMDD(chartEndStr) || defaultEnd;
    // 保证 end >= start
    if (d < chartStartDate) return chartStartDate;
    return d;
  }, [chartEndStr, chartStartDate, defaultEnd]);

  // =============== 月度生产计划（减法覆盖，按“每日”） ===============
  // monthlyOverrides: { 'YYYY-MM': dailyUnits }
  const [useMonthlyOverrides, setUseMonthlyOverrides] = useState(true);
  const [monthlyOverrides, setMonthlyOverrides] = useState({});

  // =============== 起始日+偏移的“每周收货（加法）” ===============
  // 现在的偏移相对 chartStartDate（更直观）
  const [weeklyOffsetDays, setWeeklyOffsetDays] = useState(25);
  const [weeksCount, setWeeksCount] = useState(6);
  // weeklyPlan: [{ startDate: 'YYYY-MM-DD', units: 10 }, ...]
  const [weeklyPlan, setWeeklyPlan] = useState([]);

  useEffect(() => {
    const loadCalendarData = async () => {
      try {
        const calendar = await fetchCalendarData();
        setCalendarData(calendar || {});
      } catch (error) {
        console.error('Error loading calendar data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadCalendarData();
  }, []);

  // 仅保留在图表范围内的 baseline（日历减法）
  const getFilteredCalendarData = () => {
    const filteredData = {};
    const startStr = ymd(chartStartDate);
    const endStr   = ymd(chartEndDate);
    Object.entries(calendarData).forEach(([dateStr, quantity]) => {
      if (dateStr >= startStr && dateStr <= endStr) {
        filteredData[dateStr] = quantity;
      }
    });
    return filteredData;
  };

  // 汇总未来“日历”按月（用于表格：Total Days, Calendar Total 等）
  const getMonthlyCalendarData = () => {
    const filteredCalendar = getFilteredCalendarData();
    const monthlyData = {};
    Object.entries(filteredCalendar).forEach(([dateStr, quantity]) => {
      const [year, month] = dateStr.split('-');
      const monthKey = `${year}-${month}`;
      const monthName = new Date(year, month - 1, 1).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric'
      });

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { monthName, dateCount: 0, total: 0 };
      }
      monthlyData[monthKey].dateCount += 1; // 有计划的天数（Total Days）
      monthlyData[monthKey].total += quantity; // baseline 的当月总量
    });
    return monthlyData;
  };

  // 初始化/重建 “每周收货计划”（起点=图表起始日+offset），限定在图表范围内渲染
  useEffect(() => {
    const base = new Date(chartStartDate);
    base.setDate(base.getDate() + Number(weeklyOffsetDays || 0));
    const newPlan = [];
    for (let i = 0; i < Math.max(0, Number(weeksCount || 0)); i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i * 7);
      newPlan.push({ startDate: ymd(d), units: 0 });
    }
    // 尽量合并旧值
    setWeeklyPlan((prev) => {
      const map = new Map(prev.map(p => [p.startDate, p.units]));
      return newPlan.map(p => ({ ...p, units: map.has(p.startDate) ? map.get(p.startDate) : 0 }));
    });
  }, [weeklyOffsetDays, weeksCount, chartStartDate]);

  // 统计 Van Arrived（初始库存）
  const getVanArrivedCount = () => {
    if (!data) return 0;
    return data.filter(item =>
      item['Regent Production'] &&
      item['Regent Production'].toLowerCase().includes('van arrived')
    ).length;
  };

  // Sea 状态卡片
  const getVanOnSeaData = () => {
    if (!data) return [];
    const vanOnSeaItems = data.filter(item =>
      item['Regent Production'] &&
      item['Regent Production'].toLowerCase().includes('van on the sea')
    );

    const modelRanges = {};
    vanOnSeaItems.forEach(item => {
      if (item.Chassis) {
        const modelRange = item.Chassis.substring(0, 3);
        if (!modelRanges[modelRange]) modelRanges[modelRange] = 0;
        modelRanges[modelRange] += 1;
      }
    });

    return Object.entries(modelRanges).map(([range, count]) => ({ modelRange: range, count }));
  };

  // 预计收货（来自数据的 Estimate Semi Received Date） → 表格（限定在图表范围）
  const getEstimateDateData = () => {
    if (!data) return [];
    const estimateDates = {};
    data.forEach(item => {
      if (item['Estimate Semi Received Date']) {
        const dateObj = parseDDMMYYYY(item['Estimate Semi Received Date']);
        if (dateObj) {
          const key = ymd(dateObj);
          if (dateObj >= chartStartDate && dateObj <= chartEndDate) {
            if (!estimateDates[key]) estimateDates[key] = 0;
            estimateDates[key] += 1;
          }
        }
      }
    });
    return Object.entries(estimateDates)
      .map(([date, count]) => ({
        date,
        displayDate: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        count
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  // 将 override 的“每日值”覆盖 baseline 对应月份的“每日条目”
  const buildDailyReductionsWithOverrides = (baselineDaily) => {
    // baselineDaily: { 'YYYY-MM-DD': qty, ... }
    const result = { ...baselineDaily };

    // 预先把 baseline 的日期按月份分组，仅覆盖这些“有计划的天数”
    const keysByMonth = {};
    Object.keys(baselineDaily).forEach((dateStr) => {
      const [year, month] = dateStr.split('-');
      const monthKey = `${year}-${month}`;
      if (!keysByMonth[monthKey]) keysByMonth[monthKey] = [];
      keysByMonth[monthKey].push(dateStr);
    });

    const monthsToApply = Object.entries(monthlyOverrides)
      .filter(([_, v]) => useMonthlyOverrides && v !== '' && !Number.isNaN(Number(v)))
      .map(([k, v]) => [k, Math.max(0, Number(v))]); // v = “每日”数量

    monthsToApply.forEach(([monthKey, daily]) => {
      const days = keysByMonth[monthKey] || []; // 只在 baseline 有计划的天数里覆盖
      days.forEach(dateStr => {
        result[dateStr] = daily;
      });
    });

    return result;
  };

  // ==== 组合图表数据（减法：日历/月度覆盖；加法：预计收货/每周计划） ====
  const getCombinedChartData = () => {
    if (!data) return [];

    // baseline：来自日历（未来每天要减的量，限定在图表范围）
    const filteredCalendar = getFilteredCalendarData(); // {'YYYY-MM-DD': qty}
    // 可能被 overrides（“每日”）覆盖对应月份
    const dailyReductions = buildDailyReductionsWithOverrides(filteredCalendar);

    // 预计到货（来自数据，限定在图表范围）
    const estimateDates = {};
    data.forEach(item => {
      if (item['Estimate Semi Received Date']) {
        const dateObj = parseDDMMYYYY(item['Estimate Semi Received Date']);
        if (dateObj && dateObj >= chartStartDate && dateObj <= chartEndDate) {
          const k = ymd(dateObj);
          estimateDates[k] = (estimateDates[k] || 0) + 1;
        }
      }
    });

    // 每周计划加法（限定在图表范围）
    const weeklyAdditions = {};
    weeklyPlan.forEach(w => {
      const d = parseYYYYMMDD(w.startDate);
      if (d && d >= chartStartDate && d <= chartEndDate) {
        weeklyAdditions[ymd(d)] = Math.max(0, Number(w.units) || 0);
      }
    });

    // 逐日推进
    const chartData = [];
    let currentStock = getVanArrivedCount();

    const cursor = new Date(chartStartDate);
    while (cursor <= chartEndDate) {
      const key = ymd(cursor);

      // 减法（生产/交付）
      const toReduce = dailyReductions[key] || 0;
      currentStock -= toReduce;

      // 加法（预计到货 + 每周计划收货）
      const estArrive = estimateDates[key] || 0;
      const weeklyArrive = weeklyAdditions[key] || 0;
      currentStock += estArrive + weeklyArrive;

      currentStock = Math.max(0, currentStock);

      chartData.push({
        date: key,
        displayDate: cursor.toLocaleDateString('en-US', {
          month: 'short', day: 'numeric',
          year: cursor.getFullYear()
        }),
        semivanstock: currentStock,
        estimateArrivals: estArrive,
        weeklyPlannedArrivals: weeklyArrive
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    return chartData;
  };

  // ---- memo 计算 ----
  const monthlyCalendarData = useMemo(() => getMonthlyCalendarData(), [calendarData, chartStartDate, chartEndDate]);
  const combinedChartData   = useMemo(() => getCombinedChartData(), [calendarData, monthlyOverrides, useMonthlyOverrides, weeklyPlan, data, chartStartDate, chartEndDate]);
  const vanOnSeaData        = useMemo(() => getVanOnSeaData(), [data]);
  const estimateDateTable   = useMemo(() => getEstimateDateData(), [data, chartStartDate, chartEndDate]);

  // ✅ 关键修复：该 hook 必须放在任何 return 之前（避免 React #310）
  useEffect(() => {
    // 首次为“每日覆盖值”做预填：用 baseline 的月均日值（total / dateCount）
    if (!monthlyOverrides || Object.keys(monthlyOverrides).length === 0) {
      const prefill = {};
      Object.entries(monthlyCalendarData).forEach(([k, v]) => {
        const dailyAvg = v.dateCount ? (v.total / v.dateCount) : 0;
        prefill[k] = Math.round(dailyAvg);
      });
      setMonthlyOverrides(prefill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthlyCalendarData]);

  // ---- Loading ----
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-600">Loading stock level analysis...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Stock Level Analysis</h1>

      {/* ========== 图表日期范围（横坐标） ========== */}
      <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
        <h2 className="text-xl font-semibold text-gray-800">Chart Date Range</h2>
        <div className="flex items-center gap-4 flex-wrap">
          <label className="text-sm">
            Start:&nbsp;
            <input
              type="date"
              className="border rounded px-2 py-1"
              value={chartStartStr}
              onChange={(e) => setChartStartStr(e.target.value)}
            />
          </label>
          <label className="text-sm">
            End:&nbsp;
            <input
              type="date"
              className="border rounded px-2 py-1"
              value={chartEndStr}
              onChange={(e) => setChartEndStr(e.target.value)}
              min={chartStartStr}
            />
          </label>
          <div className="text-xs text-gray-500">
            Data inside this range drives the chart, monthly table, and calculations.
          </div>
        </div>
      </div>

      {/* ========== 月度生产计划（减法覆盖，按每日） ========== */}
      <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-xl font-semibold text-gray-800">Monthly Production Plan (Subtract)</h2>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={useMonthlyOverrides}
              onChange={(e) => setUseMonthlyOverrides(e.target.checked)}
            />
            <span>Apply overrides (use daily value to replace calendar days)</span>
          </label>
        </div>

        {Object.keys(monthlyCalendarData).length === 0 ? (
          <div className="text-gray-500">No calendar days found within the selected range.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-gray-200 text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-200 px-3 py-2 text-left">Month</th>
                  <th className="border border-gray-200 px-3 py-2 text-left">Total Days</th>
                  <th className="border border-gray-200 px-3 py-2 text-left">Calendar Total</th>
                  <th className="border border-gray-200 px-3 py-2 text-left">Override Daily</th>
                  <th className="border border-gray-200 px-3 py-2 text-left">Override Total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(monthlyCalendarData)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([monthKey, monthData]) => {
                    const dailyVal = Number(monthlyOverrides[monthKey] ?? 0);
                    const totalOverride = Math.max(0, Math.round(dailyVal * monthData.dateCount));
                    return (
                      <tr key={monthKey} className="hover:bg-gray-50">
                        <td className="border border-gray-200 px-3 py-2 font-medium">{monthData.monthName}</td>
                        <td className="border border-gray-200 px-3 py-2">{monthData.dateCount}</td>
                        <td className="border border-gray-200 px-3 py-2">{monthData.total}</td>
                        <td className="border border-gray-200 px-3 py-2">
                          <input
                            type="number"
                            className="w-28 border rounded px-2 py-1"
                            value={monthlyOverrides[monthKey] ?? ''}
                            onChange={(e) =>
                              setMonthlyOverrides((prev) => ({ ...prev, [monthKey]: e.target.value }))
                            }
                            min="0"
                            step="1"
                          />
                        </td>
                        <td className="border border-gray-200 px-3 py-2">
                          <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded">
                            {totalOverride}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div className="mt-3 text-xs text-gray-500">
              Notes: “Override Daily” 只覆盖该月**日历里有计划的天数**（Total Days）；“Override Total = Daily × Total Days”。
            </div>
          </div>
        )}
      </div>

      {/* ========== 25天后每周收货（加法） ========== */}
      <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
        <h2 className="text-xl font-semibold text-gray-800">Planned Weekly Receipts (Add)</h2>
        <div className="flex items-center gap-4 flex-wrap">
          <label className="text-sm">
            Start offset (days from chart start):&nbsp;
            <input
              type="number"
              className="w-24 border rounded px-2 py-1"
              value={weeklyOffsetDays}
              min="0"
              onChange={(e) => setWeeklyOffsetDays(Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            Weeks to plan:&nbsp;
            <input
              type="number"
              className="w-20 border rounded px-2 py-1"
              value={weeksCount}
              min="0"
              onChange={(e) => setWeeksCount(Number(e.target.value))}
            />
          </label>
        </div>

        {weeklyPlan.length === 0 ? (
          <div className="text-gray-500">No weeks configured.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-gray-200 text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-200 px-3 py-2 text-left">Week Start</th>
                  <th className="border border-gray-200 px-3 py-2 text-left">Units</th>
                </tr>
              </thead>
              <tbody>
                {weeklyPlan.map((w, idx) => (
                  <tr key={w.startDate} className="hover:bg-gray-50">
                    <td className="border border-gray-200 px-3 py-2 font-mono">{w.startDate}</td>
                    <td className="border border-gray-200 px-3 py-2">
                      <input
                        type="number"
                        className="w-28 border rounded px-2 py-1"
                        value={w.units}
                        min="0"
                        onChange={(e) => {
                          const val = Math.max(0, Number(e.target.value));
                          setWeeklyPlan((prev) => {
                            const copy = [...prev];
                            copy[idx] = { ...copy[idx], units: val };
                            return copy;
                          });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 text-xs text-gray-500">
              Notes: weekly units are added on the listed start date (once per week), only within the selected chart range.
            </div>
          </div>
        )}
      </div>

      {/* 趋势图（横坐标=可配置日期范围） */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Semi Van Stock Trend</h2>
        <div className="mb-4 text-sm text-gray-600 space-y-1">
          <div>Starting stock (Van Arrived): <span className="font-semibold text-blue-600">{getVanArrivedCount()}</span> units</div>
          <div>
            Chart period:&nbsp;
            <span className="font-semibold text-green-600">
              {chartStartDate.toLocaleDateString('en-US')} - {chartEndDate.toLocaleDateString('en-US')}
            </span>
          </div>
        </div>

        {combinedChartData.length === 0 ? (
          <div className="text-center text-gray-500 py-8">No trend data available within the selected range</div>
        ) : (
          <div className="h-[440px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={combinedChartData}>
                <defs>
                  <linearGradient id="stockGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e7ff" />
                <XAxis
                  dataKey="displayDate"
                  tick={{ fontSize: 11, fill: '#4b5563' }}
                  interval="preserveStartEnd"
                  axisLine={{ stroke: '#9ca3af' }}
                />
                <YAxis
                  yAxisId="stock"
                  orientation="left"
                  tick={{ fontSize: 11, fill: '#4b5563' }}
                  axisLine={{ stroke: '#9ca3af' }}
                  label={{ value: 'Stock Level', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' } }}
                />
                <YAxis
                  yAxisId="arrivals"
                  orientation="right"
                  tick={{ fontSize: 11, fill: '#4b5563' }}
                  axisLine={{ stroke: '#9ca3af' }}
                  label={{ value: 'Arrivals', angle: 90, position: 'insideRight', style: { textAnchor: 'middle' } }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid '#e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                  }}
                  labelFormatter={(value) => `Date: ${value}`}
                  formatter={(value, name) => [
                    `${value} ${name.includes('Stock') ? 'units' : 'arrivals'}`,
                    name
                  ]}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />

                {/* 预计到货（原） */}
                <Bar
                  yAxisId="arrivals"
                  dataKey="estimateArrivals"
                  fill="#10b981"
                  fillOpacity={0.7}
                  name="Expected Arrivals"
                  radius={[2, 2, 0, 0]}
                />
                {/* 每周计划收货 */}
                <Bar
                  yAxisId="arrivals"
                  dataKey="weeklyPlannedArrivals"
                  fill="#f59e0b"
                  fillOpacity={0.85}
                  name="Planned Weekly Receipts"
                  radius={[2, 2, 0, 0]}
                />
                {/* 库存曲线 */}
                <Line
                  yAxisId="stock"
                  type="monotone"
                  dataKey="semivanstock"
                  stroke="#3b82f6"
                  strokeWidth={3}
                  name="Semi Van Stock"
                  dot={{
                    fill: '#3b82f6',
                    strokeWidth: 2,
                    stroke: '#ffffff',
                    r: 3.5
                  }}
                  activeDot={{ r: 6, fill: '#1d4ed8', stroke: '#ffffff', strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Sea 状态卡片 */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Van on the Sea Status - Model Ranges</h2>
        {vanOnSeaData.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {vanOnSeaData.map((item) => (
              <div key={item.modelRange} className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-lg p-4 text-center">
                <div className="text-lg font-bold text-orange-800 mb-2">{item.modelRange}</div>
                <div className="text-2xl font-bold text-orange-600">{item.count}</div>
                <div className="text-xs text-orange-700 mt-1">vans on sea</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-500 py-8">No vans currently on the sea</div>
        )}
      </div>

      {/* Estimated Arrivals Summary（限定在图表范围） */}
      <div className="bg-white p-6 rounded-lg border mb-6">
        <h3 className="text-lg font-semibold mb-4">📅 Estimated Arrivals</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-gray-300">
            <thead>
              <tr className="bg-blue-50">
                <th className="border border-gray-300 px-4 py-2 text-left">Date</th>
                <th className="border border-gray-300 px-4 py-2 text-left">Number of Units</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const dateStats = {};
                (data || []).forEach(item => {
                  const estimateDate = item['Estimate Semi Received Date'];
                  const d = parseDDMMYYYY(estimateDate);
                  if (d && d >= chartStartDate && d <= chartEndDate) {
                    const key = ymd(d);
                    dateStats[key] = dateStats[key] || { count: 0, originalDate: estimateDate };
                    dateStats[key].count += 1;
                  }
                });

                const sorted = Object.keys(dateStats).sort();
                if (sorted.length === 0) {
                  return (
                    <tr>
                      <td colSpan="2" className="border border-gray-300 px-4 py-8 text-center text-gray-500">
                        No estimated arrival dates found in range
                      </td>
                    </tr>
                  );
                }

                return sorted.map((key) => (
                  <tr key={key} className="hover:bg-blue-50">
                    <td className="border border-gray-300 px-4 py-2 font-mono font-semibold">
                      {dateStats[key].originalDate}
                    </td>
                    <td className="border border-gray-300 px-4 py-2">
                      <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full font-semibold">
                        {dateStats[key].count}
                      </span>
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default StockLevelAnalysis;
