import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  BarChart, Bar
} from 'recharts';

// SIDEWALK DRAINAGE TURBIDITY THRESHOLDS
// Based on real-world urban drainage water quality standards
// ESP32 sends NTU values directly (0-3000 range from map(4000, 1000, 0, 3000))
const thresholds = {
  normal: 50,     // Clear drainage water (normal runoff)
  warning: 200,   // Moderate sediment (light debris, leaves)
  danger: 500,    // High sediment (significant debris, silt)
  critical: 1000  // Extreme sediment (clogging imminent - requires immediate action)
};

const Dashboard = () => {
  // core data + ui
  const [turbidityData, setTurbidityData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ latest: 0, average: 0, highest: 0, trend: 'stable' });
  const [error, setError] = useState(null);
  const [alertLevel, setAlertLevel] = useState('normal');
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [isLive, setIsLive] = useState(false);
  const [newDataAlert, setNewDataAlert] = useState(false);
  const [riskAssessment, setRiskAssessment] = useState(null);

  // sediment analytics
  const [accumulationRate, setAccumulationRate] = useState(0); // NTU/hour
  const [daysToClog, setDaysToClog] = useState(null); // days estimate
  const [stabilityIndex, setStabilityIndex] = useState(100); // 0-100
  const [distribution, setDistribution] = useState({
    normal: 0, warning: 0, danger: 0, critical: 0
  });

  const [timeRange, setTimeRange] = useState('today'); // 'today' | 'week' | 'month'

  const lastDataId = useRef(0);
  const chartDataRef = useRef([]);
  const statsRef = useRef(stats);
  const turbidityDataRef = useRef(turbidityData);

  useEffect(() => {
    statsRef.current = stats;
    turbidityDataRef.current = turbidityData;
  }, [stats, turbidityData]);

  // Sidewalk drainage clogging risk assessment
  const predictCloggingRisk = useCallback((latest, average, trend, currentAlertLevel) => {
    if (currentAlertLevel === 'critical' || latest >= thresholds.critical) {
      return {
        risk: 'EXTREME',
        timeframe: 'IMMEDIATE (1-3 hours)',
        action: 'URGENT: Clear sidewalk drain immediately - High flooding risk',
        probability: '85-95%',
        consequences: 'Sidewalk flooding imminent - Public safety hazard',
        maintenance: 'Emergency drain cleaning required - Dispatch crew immediately'
      };
    } else if (currentAlertLevel === 'danger' || latest >= thresholds.danger) {
      return {
        risk: 'HIGH',
        timeframe: '4-12 hours',
        action: 'Schedule drain cleaning within 24 hours - Monitor closely',
        probability: '65-80%',
        consequences: 'Moderate flooding risk during rain - Potential sidewalk blockage',
        maintenance: 'Schedule maintenance within 24 hours'
      };
    } else if (currentAlertLevel === 'warning' || latest >= thresholds.warning) {
      return {
        risk: 'MODERATE',
        timeframe: '1-3 days if trend continues',
        action: 'Plan routine cleaning - Monitor accumulation rate',
        probability: '35-60%',
        consequences: 'Light debris accumulation - Reduce drainage efficiency',
        maintenance: 'Schedule routine maintenance within 1 week'
      };
    }
    return {
      risk: 'LOW',
      timeframe: 'No immediate threat',
      action: 'Normal operation - Continue routine monitoring',
      probability: '5-20%',
      consequences: 'Clear drainage flow - Normal urban runoff',
      maintenance: 'Continue routine inspections'
    };
  }, []);

  // Sensor validation - ESP32 sends NTU values directly (0-3000)
  // Raw sensor range: 4000 (clear) to 1000 (turbid) → NTU: 0 (clear) to 3000 (turbid)
  const checkSensorCalibration = (readings) => {
    if (!readings || readings.length === 0) return;
    const avgReading = readings.reduce((sum, val) => sum + val.value, 0) / readings.length;
    // Check if values are out of expected NTU range (0-3000)
    if (avgReading > 3000 || avgReading < 0) {
      console.warn('⚠️ SENSOR CALIBRATION WARNING: Unexpected NTU value:', avgReading);
      return true;
    }
    return false;
  };

  // ESP32 already converts raw value to NTU, so use value directly
  // No inversion needed - ESP32 map(rawValue, 4000, 1000, 0, 3000) handles conversion
  const processSensorValue = (value) => {
    // ESP32 sends integer NTU values (0-3000)
    // Ensure value is within expected range
    if (value < 0) return 0;
    if (value > 3000) return 3000;
    return Math.round(value);
  };

  // calculate trend helper function
  const calculateTrend = (values) => {
    if (!values || values.length < 2) return 'stable';
    const mid = Math.floor(values.length / 2);
    const first = values.slice(0, mid);
    const second = values.slice(mid);
    const avg1 = first.reduce((a, b) => a + b, 0) / first.length;
    const avg2 = second.reduce((a, b) => a + b, 0) / second.length;
    if (avg2 > avg1 * 1.1) return 'rising';
    if (avg2 < avg1 * 0.9) return 'falling';
    return 'stable';
  };

  // Helper functions that don't depend on state - define first
  const determineAlertLevel = useCallback((latest, average, trend) => {
    if (latest >= thresholds.critical || average >= thresholds.critical) {
      return 'critical';
    } else if (latest >= thresholds.danger || average >= thresholds.danger) {
      return trend === 'rising' ? 'critical' : 'danger';
    } else if (latest >= thresholds.warning || average >= thresholds.warning) {
      return trend === 'rising' ? 'danger' : 'warning';
    } else if (latest >= thresholds.normal) {
      return trend === 'rising' ? 'warning' : 'normal';
    }
    return 'normal';
  }, []);

  const computeAccumulationMetrics = useCallback((formatted) => {
    if (!formatted || formatted.length < 2) {
      setAccumulationRate(0);
      setDaysToClog(null);
      setStabilityIndex(100);
      return;
    }
    const N = Math.min(6, formatted.length - 1);
    let totalRate = 0;
    let used = 0;
    for (let i = formatted.length - N; i < formatted.length; i++) {
      const cur = formatted[i];
      const prev = formatted[i - 1];
      if (!prev) continue;
      const dtHours = (cur.fullDate - prev.fullDate) / 3600000;
      if (dtHours <= 0) continue;
      const dntu = (cur.value - prev.value);
      const rate = dntu / dtHours;
      totalRate += rate;
      used++;
    }
    const avgRate = used ? totalRate / used : 0;
    setAccumulationRate(Number(avgRate.toFixed(2)));
    const current = formatted[formatted.length - 1].value;
    if (avgRate > 0) {
      const ntuLeft = thresholds.critical - current;
      const hoursToClog = ntuLeft > 0 ? (ntuLeft / avgRate) : 0;
      setDaysToClog(hoursToClog > 0 ? Number((hoursToClog / 24).toFixed(1)) : 0);
    } else {
      setDaysToClog(null);
    }
    const stability = Math.max(0, 100 - Math.min(100, Math.abs(avgRate) / thresholds.critical * 100));
    setStabilityIndex(Math.round(stability));
  }, []);

  const computeDistribution = useCallback((values) => {
    const bins = { normal: 0, warning: 0, danger: 0, critical: 0 };
    if (!values || values.length === 0) {
      setDistribution(bins);
      return;
    }
    values.forEach(v => {
      if (v < thresholds.normal) bins.normal++;
      else if (v < thresholds.warning) bins.warning++;
      else if (v < thresholds.danger) bins.danger++;
      else bins.critical++;
    });
    setDistribution(bins);
  }, []);

  // main process function — transforms and calculates analytics
  const processTurbidityData = useCallback((data) => {
    const formatted = data
      .map(item => ({
        time: new Date(item.created_at).toLocaleTimeString(),
        value: processSensorValue(item.value), // ESP32 sends NTU directly, no inversion needed
        fullDate: new Date(item.created_at),
        date: new Date(item.created_at).toLocaleDateString(),
        id: item.id,
        originalValue: item.value // Store original for debugging
      }))
      .reverse();
    const values = formatted.map(d => Number(d.value) || 0);
    const latest = values.length ? values[values.length - 1] : 0;
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const highest = values.length ? Math.max(...values) : 0;
    const trend = calculateTrend(values.slice(-10));
    const alert = determineAlertLevel(latest, average, trend);
    const risk = predictCloggingRisk(latest, average, trend, alert);
    computeAccumulationMetrics(formatted);
    computeDistribution(values);
    setTurbidityData(formatted.slice(-1000));
    chartDataRef.current = formatted.slice(-1000);
    setStats({ latest, average: Math.round(average), highest, trend });
    setAlertLevel(alert);
    setRiskAssessment(risk);
  }, [computeAccumulationMetrics, computeDistribution, determineAlertLevel, predictCloggingRisk]);

  // incremental update for small inserts
  const updateStatsIncrementally = useCallback((data) => {
    if (!data || data.length === 0) return;
    const values = data.map(d => Number(d.value) || 0);
    const latest = values[values.length - 1];
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const highest = Math.max(...values);
    const trend = calculateTrend(values.slice(-10));
    const alert = determineAlertLevel(latest, avg, trend);
    const risk = predictCloggingRisk(latest, avg, trend, alert);
    computeAccumulationMetrics(data);
    computeDistribution(values);
    setStats({ latest, average: Math.round(avg), highest, trend });
    setAlertLevel(alert);
    setRiskAssessment(risk);
  }, [computeAccumulationMetrics, computeDistribution, determineAlertLevel, predictCloggingRisk]);

  // fetch only new rows since last id
  const fetchNewData = useCallback(async (sinceId) => {
    try {
      const { data, error } = await supabase
        .from('turbidity_readings')
        .select('id, value, created_at')
        .gt('id', sinceId)
        .order('id', { ascending: true });
      if (error) {
        console.error('Error fetching new data:', error);
        return;
      }
      if (data && data.length > 0) {
        const newDataPoints = data.map(item => ({
          time: new Date(item.created_at).toLocaleTimeString(),
          value: processSensorValue(item.value), // ESP32 sends NTU directly
          fullDate: new Date(item.created_at),
          date: new Date(item.created_at).toLocaleDateString(),
          id: item.id,
          originalValue: item.value
        }));
        lastDataId.current = data[data.length - 1].id;
        const updatedData = [...turbidityDataRef.current, ...newDataPoints].slice(-1000);
        setTurbidityData(updatedData);
        chartDataRef.current = updatedData;
        updateStatsIncrementally(updatedData);
        setNewDataAlert(true);
        setLastUpdate(new Date());
        setTimeout(() => setNewDataAlert(false), 4000);
      }
    } catch (err) {
      console.error('Error fetching new rows:', err);
    }
  }, [updateStatsIncrementally]);

  // check for newest row
  const checkForNewData = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('turbidity_readings')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);
      if (error) {
        console.error('Error checking for new data:', error);
        return;
      }
      if (data && data.length > 0) {
        const latestId = data[0].id;
        if (latestId > lastDataId.current) fetchNewData(lastDataId.current);
      }
    } catch (err) {
      console.error('Error in data check:', err);
    }
  }, [fetchNewData]);

  // Build a Supabase date filter based on the timeRange - memoized
  const buildDateFilter = useCallback(() => {
    const now = new Date();
    if (timeRange === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
      return (query) => query.gte('created_at', start);
    }
    if (timeRange === 'week') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      return (query) => query.gte('created_at', start);
    }
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return (query) => query.gte('created_at', start);
  }, [timeRange]);

  // fetch data (with time filter)
  const fetchTurbidityData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('turbidity_readings')
        .select('id, value, created_at')
        .order('created_at', { ascending: false })
        .limit(1000); // fetch up to 1000 for range aggregation

      // apply date filter
      const applyFilter = buildDateFilter();
      query = applyFilter(query);

      const { data, error: supabaseError } = await query;

      if (supabaseError) {
        console.error('Supabase error:', supabaseError);
        setError('Failed to fetch data from database');
        return;
      }

      if (data && data.length > 0) {
        checkSensorCalibration(data);
        lastDataId.current = data[0].id;
        processTurbidityData(data);
        setLastUpdate(new Date());
        setError(null);
      } else {
        setTurbidityData([]);
        setError('No data found in turbidity_readings table for selected range');
      }
    } catch (err) {
      console.error('Error:', err);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, [buildDateFilter, processTurbidityData]);

  useEffect(() => {
    fetchTurbidityData();

    const intervalId = setInterval(() => {
      if (isLive) checkForNewData();
    }, 10000);

    return () => clearInterval(intervalId);
  }, [isLive, fetchTurbidityData, checkForNewData]);

  // small helpers
  const getAlertConfig = (level) => {
    const configs = {
      normal: { color: 'green', icon: '✅', message: 'Clear drainage - Normal sidewalk runoff conditions', bgColor: 'bg-green-100', borderColor: 'border-green-400', textColor: 'text-green-800' },
      warning: { color: 'yellow', icon: '⚠️', message: 'Moderate debris - Light accumulation in sidewalk drain', bgColor: 'bg-yellow-100', borderColor: 'border-yellow-400', textColor: 'text-yellow-800' },
      danger: { color: 'orange', icon: '🚨', message: 'High sediment - Drain cleaning required to prevent flooding', bgColor: 'bg-orange-100', borderColor: 'border-orange-400', textColor: 'text-orange-800' },
      critical: { color: 'red', icon: '🔥', message: 'CRITICAL - Immediate drain cleaning required - Sidewalk flooding risk', bgColor: 'bg-red-100', borderColor: 'border-red-400', textColor: 'text-red-800' }
    };
    return configs[level] || configs.normal;
  };

  const getStatus = (v) => {
    if (v >= thresholds.critical) return '🔥 Critical - Clogging Imminent';
    if (v >= thresholds.danger) return '🚨 High - Clean Soon';
    if (v >= thresholds.warning) return '⚠️ Moderate - Monitor Closely';
    return '✅ Clear - Normal Flow';
  };

  const getStatusColor = (v) => {
    if (v >= thresholds.critical) return 'text-red-700';
    if (v >= thresholds.danger) return 'text-orange-600';
    if (v >= thresholds.warning) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getTrendIcon = (trend) => (trend === 'rising' ? '📈' : trend === 'falling' ? '📉' : '➡️');

  const toggleLiveUpdates = () => setIsLive(!isLive);

  // build insight summary for sidewalk drainage
  const buildInsight = () => {
    if (!turbidityData || turbidityData.length < 2) return 'Collecting initial data from sidewalk drainage sensor...';
    const rate = accumulationRate;
    if (rate >= thresholds.critical * 0.1) {
      return `⚠️ Rapid debris accumulation detected (~${rate} NTU/hr) at sidewalk drain. High flooding risk — ${riskAssessment?.probability || ''}. ${daysToClog ? `Estimated blockage in ${daysToClog} days.` : ''} Dispatch maintenance crew immediately.`;
    }
    if (rate > 0) {
      return `Debris gradually accumulating (~${rate} NTU/hr) in sidewalk drainage. Stability index ${stabilityIndex}%. Schedule routine cleaning before next rainfall.`;
    }
    if (rate < 0) {
      return `✅ Debris levels decreasing - drain recently cleaned or heavy rain flushed system. Stability index ${stabilityIndex}%. System functioning normally.`;
    }
    return `Stable drainage conditions. Stability index ${stabilityIndex}%. Sidewalk drain operating normally with minimal debris accumulation.`;
  };

  // UI handlers
  const onTimeRangeChange = (range) => {
    setTimeRange(range);
  };

  // Print records function
  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow pop-ups to print records');
      return;
    }

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Turbidity Records Report</title>
          <style>
            @media print {
              body { margin: 0; padding: 20px; font-family: Arial, sans-serif; }
            }
            body { margin: 20px; font-family: Arial, sans-serif; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
            .header h1 { margin: 0; color: #2563eb; }
            .header p { margin: 5px 0; color: #666; }
            .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin: 30px 0; padding: 20px; background: #f5f5f5; border-radius: 8px; }
            .summary-item { text-align: center; }
            .summary-item strong { display: block; margin-bottom: 5px; color: #333; }
            .summary-item span { font-size: 24px; font-weight: bold; color: #2563eb; }
            table { width: 100%; border-collapse: collapse; margin: 30px 0; }
            th { background: #2563eb; color: white; padding: 12px; text-align: left; font-weight: bold; }
            td { padding: 10px; border-bottom: 1px solid #ddd; }
            tr:nth-child(even) { background: #f9f9f9; }
            .status-normal { color: green; font-weight: bold; }
            .status-warning { color: orange; font-weight: bold; }
            .status-danger { color: red; font-weight: bold; }
            .status-critical { color: darkred; font-weight: bold; }
            .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 12px; }
            @page { size: A4 landscape; margin: 1cm; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Sidewalk Drainage Monitoring Report</h1>
            <p>Generated: ${new Date().toLocaleString()}</p>
            <p>Time Range: ${timeRange.charAt(0).toUpperCase() + timeRange.slice(1)} | Total Records: ${turbidityData.length}</p>
          </div>

          <div class="summary">
            <div class="summary-item">
              <strong>Latest Reading</strong>
              <span>${stats.latest} NTU</span>
            </div>
            <div class="summary-item">
              <strong>Average</strong>
              <span>${stats.average} NTU</span>
            </div>
            <div class="summary-item">
              <strong>Peak</strong>
              <span>${stats.highest} NTU</span>
            </div>
            <div class="summary-item">
              <strong>Trend</strong>
              <span>${stats.trend}</span>
            </div>
          </div>

          <div class="summary">
            <div class="summary-item">
              <strong>Accumulation Rate</strong>
              <span>${accumulationRate} NTU/hr</span>
            </div>
            <div class="summary-item">
              <strong>Days to Clog</strong>
              <span>${daysToClog !== null ? daysToClog + ' days' : 'Stable'}</span>
            </div>
            <div class="summary-item">
              <strong>Stability Index</strong>
              <span>${stabilityIndex}%</span>
            </div>
            <div class="summary-item">
              <strong>Alert Level</strong>
              <span>${alertLevel.toUpperCase()}</span>
            </div>
          </div>

          ${riskAssessment ? `
          <div style="margin: 20px 0; padding: 15px; background: ${alertLevel === 'critical' ? '#fee' : alertLevel === 'danger' ? '#fff3e0' : '#fff8e1'}; border-left: 4px solid ${alertLevel === 'critical' ? 'red' : alertLevel === 'danger' ? 'orange' : 'yellow'};">
            <strong>Risk Assessment:</strong> ${riskAssessment.risk}<br>
            <strong>Timeframe:</strong> ${riskAssessment.timeframe}<br>
            <strong>Probability:</strong> ${riskAssessment.probability}<br>
            <strong>Action:</strong> ${riskAssessment.action}
          </div>
          ` : ''}

          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Date & Time</th>
                <th>Value (NTU)</th>
                <th>Raw Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${turbidityData.map((record, index) => {
                let statusClass = 'status-normal';
                let statusText = 'Clear Water';
                if (record.value >= thresholds.critical) {
                  statusClass = 'status-critical';
                  statusText = 'Critical';
                } else if (record.value >= thresholds.danger) {
                  statusClass = 'status-danger';
                  statusText = 'High';
                } else if (record.value >= thresholds.warning) {
                  statusClass = 'status-warning';
                  statusText = 'Moderate';
                }
                return `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${record.fullDate.toLocaleString()}</td>
                    <td>${record.value.toFixed(2)}</td>
                    <td>${record.originalValue ?? record.value}</td>
                    <td class="${statusClass}">${statusText}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <div class="footer">
            <p>Report generated from Turbidity Dashboard | ${new Date().toLocaleString()}</p>
            <p>Thresholds: Normal (0-${thresholds.normal-1} NTU), Warning (${thresholds.normal}-${thresholds.warning-1} NTU), Danger (${thresholds.warning}-${thresholds.danger-1} NTU), Critical (${thresholds.danger}+ NTU)</p>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
    
    // Wait for content to load, then print
    setTimeout(() => {
      printWindow.print();
      // Optional: Close after printing (uncomment if desired)
      // printWindow.close();
    }, 250);
  };

  // small loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl text-gray-600 mb-2">Loading Sidewalk Drainage Monitoring System...</div>
          <div className="text-sm text-gray-500">Connecting to ESP32 sensor...</div>
        </div>
      </div>
    );
  }

  const alertConfig = getAlertConfig(alertLevel);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Error Message */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-800 px-4 py-3 rounded-lg mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <span className="text-xl mr-2">❌</span>
                <div>
                  <strong>Error:</strong>
                  <p className="text-sm">{error}</p>
                </div>
              </div>
              <button 
                onClick={() => setError(null)} 
                className="text-red-800 hover:text-red-900 ml-4"
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* New Data Alert */}
        {newDataAlert && (
          <div className="bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded-lg mb-4 animate-pulse">
            <div className="flex items-center">
              <span className="text-xl mr-2">✨</span>
              <div>
                <strong>New Data Available!</strong>
                <p className="text-sm">Fresh readings have been added to the dashboard.</p>
              </div>
            </div>
          </div>
        )}

        {/* Sensor Status Notice */}
        {checkSensorCalibration(turbidityData.length > 0 ? turbidityData.map(d => ({value: d.value})) : []) && (
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded-lg mb-4">
            <div className="flex items-center">
              <span className="text-xl mr-2">🔧</span>
              <div>
                <strong>Sensor Status Alert:</strong>
                <p className="text-sm">
                  Unexpected NTU values detected — check ESP32 sensor connection or calibration at sidewalk drain location.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Location Info */}
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-2 rounded-lg mb-4 text-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className="mr-2">📍</span>
              <span><strong>Monitoring:</strong> Sidewalk Drainage System | ESP32 Sensor Active | Update Frequency: 5 seconds</span>
            </div>
            <span className="text-xs bg-blue-200 px-2 py-1 rounded">Live</span>
          </div>
        </div>

        {/* Status bar + time range */}
        <div className="bg-white border px-4 py-3 rounded-lg mb-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="text-xl">{isLive ? '🔄' : '⏸️'}</div>
            <div>
              <div className="font-medium">{isLive ? 'Live monitoring active' : 'Updates paused'}</div>
              <div className="text-xs text-gray-500">Last update: {lastUpdate.toLocaleString()}</div>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <div className="text-xs text-gray-600 mr-2">Range:</div>
            <div className="flex space-x-2">
              <button onClick={() => onTimeRangeChange('today')} className={`px-3 py-1 rounded ${timeRange === 'today' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Today</button>
              <button onClick={() => onTimeRangeChange('week')} className={`px-3 py-1 rounded ${timeRange === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Week</button>
              <button onClick={() => onTimeRangeChange('month')} className={`px-3 py-1 rounded ${timeRange === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Month</button>
            </div>

            <div className="text-xs bg-gray-200 px-2 py-1 rounded">Raw: {turbidityData[turbidityData.length - 1]?.originalValue ?? stats.latest} </div>

            <button onClick={toggleLiveUpdates} className={`px-3 py-1 rounded ${isLive ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}>
              {isLive ? 'Pause' : 'Resume'}
            </button>
          </div>
        </div>

        {/* Alert banner */}
        <div className={`${alertConfig.bgColor} border ${alertConfig.borderColor} ${alertConfig.textColor} px-6 py-4 rounded-lg mb-6`}>
          <div className="flex items-start">
            <span className="text-2xl mr-3 mt-1">{alertConfig.icon}</span>
            <div className="flex-1">
              <h2 className="text-xl font-bold">Turbidity Alert: {alertConfig.message}</h2>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                <div><strong>Risk Level:</strong> <span className="ml-2 font-semibold">{riskAssessment?.risk ?? 'N/A'}</span></div>
                <div><strong>Timeframe:</strong> <span className="ml-2">{riskAssessment?.timeframe ?? 'N/A'}</span></div>
                <div><strong>Probability:</strong> <span className="ml-2">{riskAssessment?.probability ?? 'N/A'}</span></div>
                <div><strong>Action:</strong> <span className="ml-2">{riskAssessment?.action ?? 'N/A'}</span></div>
              </div>

              <p className="text-sm mt-2">
                <strong>Current Reading:</strong> {stats.latest} NTU — {stats.latest < thresholds.normal ? 'Clear Drainage Water' : stats.latest >= thresholds.critical ? 'Severe Clogging Risk' : 'Turbid - Requires Attention'}
              </p>
              {riskAssessment?.maintenance && (
                <p className="text-sm mt-2 font-semibold">
                  <strong>Maintenance Action:</strong> {riskAssessment.maintenance}
                </p>
              )}
            </div>
          </div>
        </div>

        <h1 className="text-3xl font-semibold text-gray-800 mb-2">Sidewalk Drainage Monitoring System</h1>
        <p className="text-gray-600 mb-6">Real-time turbidity monitoring for urban sidewalk drainage infrastructure</p>

        {/* Main Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div className="bg-white p-5 rounded shadow">
            <div className="text-sm font-semibold text-gray-600">Latest</div>
            <div className={`text-2xl font-bold ${getStatusColor(stats.latest)}`}>{stats.latest} NTU</div>
            <div className="text-xs text-gray-500 mt-1">{getStatus(stats.latest)}</div>
          </div>

          <div className="bg-white p-5 rounded shadow">
            <div className="text-sm font-semibold text-gray-600">Average</div>
            <div className="text-2xl font-bold text-blue-600">{stats.average} NTU</div>
            <div className="text-xs text-gray-500 mt-1">{turbidityData.length} readings</div>
          </div>

          <div className="bg-white p-5 rounded shadow">
            <div className="text-sm font-semibold text-gray-600">Peak</div>
            <div className="text-2xl font-bold text-purple-600">{stats.highest} NTU</div>
            <div className="text-xs text-gray-500 mt-1">Historical max</div>
          </div>

          <div className="bg-white p-5 rounded shadow">
            <div className="text-sm font-semibold text-gray-600">Trend</div>
            <div className="text-2xl font-bold">{getTrendIcon(stats.trend)}</div>
            <div className="text-xs text-gray-500 mt-1">{stats.trend}</div>
          </div>
        </div>

        {/* Sediment Analytics Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="font-semibold text-gray-700 mb-2">Debris Accumulation Rate</h3>
            <div className="text-3xl font-bold text-indigo-600">{accumulationRate} NTU/hr</div>
            <div className="text-xs text-gray-500 mt-1">Rate of debris buildup in sidewalk drain (positive = accumulating)</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="font-semibold text-gray-700 mb-2">Estimated Time to Blockage</h3>
            <div className="text-3xl font-bold text-red-600">{daysToClog !== null ? `${daysToClog} days` : 'No immediate risk'}</div>
            <div className="text-xs text-gray-500 mt-1">Projected days until drain blockage if trend continues</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="font-semibold text-gray-700 mb-2">Stability Index</h3>
            <div className={`text-3xl font-bold ${stabilityIndex > 70 ? 'text-green-600' : stabilityIndex > 40 ? 'text-yellow-600' : 'text-red-600'}`}>
              {stabilityIndex}%
            </div>
            <div className="text-xs text-gray-500 mt-1">Higher = more stable (less sudden accumulation)</div>
          </div>
        </div>

        {/* Insight */}
        <div className="bg-white rounded-lg shadow p-5 mb-6">
          <h3 className="font-semibold text-gray-700 mb-2">Insight</h3>
          <p className="text-sm text-gray-700">{buildInsight()}</p>
        </div>

        {/* Charts: Turbidity timeline + Accumulation rate + Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Timeline */}
          <div className="bg-white p-6 rounded shadow">
            <h3 className="text-lg font-semibold mb-4">Sidewalk Drainage Turbidity Timeline</h3>
            {turbidityData.length > 0 ? (
              <div style={{ width: '100%', height: 360 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={turbidityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" minTickGap={20} />
                    <YAxis label={{ value: 'NTU', angle: -90, position: 'insideLeft' }} />
                    <ReferenceLine y={thresholds.normal} stroke="green" label="Normal" />
                    <ReferenceLine y={thresholds.warning} stroke="orange" label="Warning" />
                    <ReferenceLine y={thresholds.danger} stroke="red" label="Danger" />
                    <ReferenceLine y={thresholds.critical} stroke="darkred" label="Critical" />
                    <Tooltip formatter={(v) => `${v} NTU`} labelFormatter={(label, payload) => (payload && payload[0] ? payload[0].payload.fullDate.toLocaleString() : label)} />
                    <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
            )}
          </div>

          {/* Distribution & accumulation */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded shadow">
              <h3 className="text-lg font-semibold mb-4">Debris Distribution Analysis</h3>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { name: '0-99', count: distribution.normal },
                    { name: '100-499', count: distribution.warning },
                    { name: '500-999', count: distribution.danger },
                    { name: '1000+', count: distribution.critical }
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#7c3aed" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-xs text-gray-500 mt-2">Distribution of readings showing debris levels in sidewalk drainage.</div>
            </div>

            <div className="bg-white p-6 rounded shadow">
              <h3 className="text-lg font-semibold mb-4">Debris Accumulation Rate (Δ NTU/hr)</h3>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={turbidityData.map((d, i, arr) => {
                    if (i === 0) return { time: d.time, rate: 0 };
                    const prev = arr[i - 1];
                    const dtHours = (new Date(d.fullDate) - new Date(prev.fullDate)) / 3600000 || 1/3600;
                    const diff = (d.value - prev.value) / dtHours;
                    return { time: d.time, rate: Number(diff.toFixed(2)) };
                  })}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis label={{ value: 'Δ NTU/hr', angle: -90, position: 'insideLeft' }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="rate" stroke="#ef4444" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="text-xs text-gray-500 mt-2">Positive = debris accumulating (clogging risk); Negative = debris clearing (rain or cleaning)</div>
            </div>
          </div>
        </div>

        {/* manual refresh and print */}
        <div className="flex justify-center gap-4">
          <button onClick={fetchTurbidityData} className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-8 rounded shadow inline-flex items-center">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581" /></svg>
            Manual Refresh
          </button>
          
          <button 
            onClick={handlePrint} 
            disabled={turbidityData.length === 0}
            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium py-3 px-8 rounded shadow inline-flex items-center"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
            Print Records
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
