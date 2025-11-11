import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  BarChart, Bar
} from 'recharts';

// NTU THRESHOLDS (research-based values from your ESP32 sketch)
// These match the thresholds used on the ESP32 device for risk assessment
const thresholds = {
  normal: 100.0,        // Clear water - normal flow
  warning: 500.0,       // Silt accumulation begins
  highRisk: 1000.0,     // Significant sedimentation risk
  clogging: 2000.0,     // High probability of clogging
  flooding: 2500.0      // Immediate flooding risk
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
  const [isDark, setIsDark] = useState(() => {
    try {
      const v = localStorage.getItem('dashboard:isDark');
      if (v !== null) return v === '1';
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });
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

  // Apply dark-mode class to <html> and persist preference
  useEffect(() => {
    try {
      if (isDark) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('dashboard:isDark', '1');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('dashboard:isDark', '0');
      }
    } catch {
      // ignore
    }
  }, [isDark]);

  const toggleTheme = () => setIsDark(d => !d);
  const handleLogout = async () => {
    try {
      // Sign out via Supabase Auth if available
      if (supabase && supabase.auth && typeof supabase.auth.signOut === 'function') {
        await supabase.auth.signOut();
      }
    } catch {
      // ignore signout errors
    }
    // Redirect to login page using Vite base URL so deployments with a base path
    // (for example '/Turbidity_Dashboard/') will correctly navigate to '/<base>/login'.
    try {
      const base = import.meta.env.BASE_URL || '/';
      // normalize base so we don't produce double slashes
      const normalized = base.endsWith('/') ? base.slice(0, -1) : base;
      const loginPath = `${normalized}/login`;
      window.location.href = loginPath;
    } catch {
      // Fallback to root login if import.meta is not available for any reason
      window.location.href = '/login';
    }
  };

  // (removed: assessFloodRisk/getSedimentationLevel) — risk text is derived directly in predictCloggingRisk

  // Sediment clogging risk assessment - aligned with NTU thresholds above
  const predictCloggingRisk = useCallback((latest) => {

    if (latest >= thresholds.flooding) {
      return {
        risk: 'EXTREME',
        floodRisk: 'EXTREME',
        sedimentLevel: 'Severe Clogging Risk',
        timeframe: 'IMMEDIATE (10-30 minutes)',
        action: '💥 CRITICAL: FLOODING IMMINENT - EMERGENCY RESPONSE REQUIRED',
        probability: '95-99%',
        consequences: 'Sidewalk flooding imminent - Public safety critical hazard',
        maintenance: 'EMERGENCY: Dispatch crew immediately - Activate emergency protocol',
        samplingInterval: '10 seconds (Maximum sampling rate)'
      };
    } else if (latest >= thresholds.clogging) {
      return {
        risk: 'VERY HIGH',
        floodRisk: 'VERY HIGH',
        sedimentLevel: 'Heavy Sediment',
        timeframe: 'IMMEDIATE (30 minutes - 2 hours)',
        action: '🚨 ALERT: DRAINAGE CLOGGING LIKELY - IMMEDIATE ACTION NEEDED',
        probability: '85-95%',
        consequences: 'Drainage system will clog rapidly - High flooding risk',
        maintenance: 'URGENT: Drain cleaning required - Dispatch within 1 hour',
        samplingInterval: '30 seconds (High risk sampling)'
      };
    } else if (latest >= thresholds.highRisk) {
      return {
        risk: 'HIGH',
        floodRisk: 'HIGH',
        sedimentLevel: 'Moderate Sediment',
        timeframe: '4-12 hours',
        action: 'Schedule drain cleaning within 24 hours - Monitor closely',
        probability: '65-80%',
        consequences: 'Moderate flooding risk during rain - Potential sidewalk blockage',
        maintenance: 'Schedule maintenance within 24 hours',
        samplingInterval: '1 minute (Elevated monitoring)'
      };
    } else if (latest >= thresholds.warning) {
      return {
        risk: 'MODERATE',
        floodRisk: 'MODERATE',
        sedimentLevel: 'Light Sediment',
        timeframe: '1-3 days if trend continues',
        action: 'Plan routine cleaning - Monitor accumulation rate',
        probability: '35-60%',
        consequences: 'Light debris accumulation - Reduced drainage efficiency',
        maintenance: 'Schedule routine maintenance within 1 week',
        samplingInterval: '1 minute (Warning monitoring)'
      };
    }
    return {
      risk: 'LOW',
      floodRisk: 'LOW',
      sedimentLevel: 'Clear Water',
      timeframe: 'No immediate threat',
      action: 'Normal operation - Continue routine monitoring',
      probability: '5-20%',
      consequences: 'Clear drainage flow - Normal urban runoff',
      maintenance: 'Continue routine inspections',
      samplingInterval: '5 minutes (Normal monitoring)'
    };
  }, []);

// Sensor validation - input to these helpers are RAW RTU values from the ESP32
// We expect raw in roughly [0..~2100]; clear water observed around 2000-2097.
const checkSensorCalibration = (readings) => {
  if (!readings || readings.length === 0) return false;
  const avgReading = readings.reduce((sum, val) => sum + Number(val.value || 0), 0) / readings.length;
  // Flag if RTU clearly out of bounds (0..~2100 expected)
  if (avgReading > 2500 || avgReading < 0) {
    console.warn('⚠️ SENSOR CALIBRATION WARNING: Unexpected RTU value:', avgReading);
    return true;
  }
  return false;
};

// processSensorValue: convert raw RTU values from ESP32 sensor to NTU values
// This uses an inverse-exponential mapping calibrated to field data:
// - Clear water: raw RTU ≈ 2000-2097 → very low NTU (clear)
// - Muddy water: raw RTU ≈ 6 → very high NTU
// The mapping is: NTU = alpha / (RTU + beta) with piecewise adjustment for clear water
// Note: if your ESP32 changes its raw RTU ranges, you'll need to recalibrate alpha/beta
const processSensorValue = (value) => {
  let rtu = Number(value);
  if (Number.isNaN(rtu)) return 0;
  
  // Clamp RTU to valid range
  rtu = Math.max(0, Math.min(2100, rtu));
  
  // Alpha and beta for inverse-exponential mapping, calibrated to field data
  const alpha = 101734.75;
  const beta = 34.69387755102041;
  
  let ntu = alpha / (rtu + beta);
  
  // Piecewise adjustment for clear water (2000-2097 raw → ~0-50 NTU linear mapping)
  if (rtu >= 2000) {
    // Linear interpolation from (2000,50) to (2097,0)
    ntu = Math.max(0, 50 * (2097 - rtu) / (2097 - 2000));
  }
  
  // Clamp final NTU and round to 0.1
  ntu = Math.max(0, Math.min(3000, ntu));
  return Math.round(ntu * 10) / 10;
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

  // Determine alert level based on ESP32 thresholds
  const determineAlertLevel = useCallback((latest, average, trend) => {
    if (latest >= thresholds.flooding || average >= thresholds.flooding) {
      return 'flooding';
    } else if (latest >= thresholds.clogging || average >= thresholds.clogging) {
      return 'clogging';
    } else if (latest >= thresholds.highRisk || average >= thresholds.highRisk) {
      return trend === 'rising' ? 'clogging' : 'highRisk';
    } else if (latest >= thresholds.warning || average >= thresholds.warning) {
      return trend === 'rising' ? 'highRisk' : 'warning';
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
    // Use a stable window (last 30 minutes or up to 60 points) to reduce noise
    const WINDOW_MS = 30 * 60 * 1000; // 30 minutes
    const MAX_POINTS = 60;
    const endIdx = formatted.length - 1;
    let startIdx = endIdx;
    const endTime = formatted[endIdx].fullDate.getTime();
    while (startIdx > 0 && (endTime - formatted[startIdx - 1].fullDate.getTime()) <= WINDOW_MS && (endIdx - (startIdx - 1)) <= MAX_POINTS) {
      startIdx--;
    }
    const windowData = formatted.slice(startIdx, endIdx + 1);
    if (windowData.length < 2) {
      const slice = formatted.slice(-Math.min(6, formatted.length));
      const first = slice[0];
      const last = slice[slice.length - 1];
      const rawDtHours = (last.fullDate - first.fullDate) / 3600000;
      const MIN_DT_HOURS = 30 / 3600;
      const dtHours = Math.max(rawDtHours, MIN_DT_HOURS);
      let clampedRate = 0;
      if (rawDtHours < MIN_DT_HOURS) {
        clampedRate = 0;
        setAccumulationRate(0);
      } else {
        const rate = (last.value - first.value) / dtHours;
        clampedRate = Math.max(-10000, Math.min(thresholds.flooding * 2, rate));
        setAccumulationRate(Number(clampedRate.toFixed(2)));
      }
      const current = last.value;
      if (clampedRate > 0) {
        const ntuLeft = thresholds.clogging - current;
        const hoursToClog = ntuLeft > 0 ? (ntuLeft / clampedRate) : 0;
        const days = hoursToClog > 0 ? Number((hoursToClog / 24).toFixed(1)) : 0;
        setDaysToClog(days);
      } else {
        setDaysToClog(null);
      }
      // Stability based on rate of change
      let stability = Math.max(0, 100 - Math.min(100, Math.abs(clampedRate) / thresholds.clogging * 100));
      setStabilityIndex(Math.round(stability));
      return;
    }

    // Compute slope via simple least squares (value vs time hours)
    const t0 = windowData[0].fullDate.getTime();
    const times = windowData.map(d => (d.fullDate.getTime() - t0) / 3600000);
    const values = windowData.map(d => d.value);
    const n = values.length;
    const meanT = times.reduce((a, b) => a + b, 0) / n;
    const meanV = values.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const dt = times[i] - meanT;
      num += dt * (values[i] - meanV);
      den += dt * dt;
    }
    let slopePerHour = den > 0 ? (num / den) : 0;
    const MAX_POS_RATE = thresholds.flooding * 2;
    const MAX_NEG_RATE = -10000;
    if (slopePerHour > MAX_POS_RATE) slopePerHour = MAX_POS_RATE;
    if (slopePerHour < MAX_NEG_RATE) slopePerHour = MAX_NEG_RATE;

    setAccumulationRate(Number(slopePerHour.toFixed(2)));

    const current = windowData[windowData.length - 1].value;
    if (slopePerHour > 0) {
      const ntuLeft = thresholds.clogging - current;
      const hoursToClog = ntuLeft > 0 ? (ntuLeft / slopePerHour) : 0;
      const days = hoursToClog > 0 ? Number((hoursToClog / 24).toFixed(1)) : 0;
      setDaysToClog(days);
    } else {
      setDaysToClog(null);
    }

    // Stability based on residual variance
    let residualSum = 0;
    for (let i = 0; i < n; i++) {
      const fitted = meanV + slopePerHour * (times[i] - meanT);
      const r = values[i] - fitted;
      residualSum += Math.abs(r);
    }
    const avgResidual = residualSum / n;
    const stability = Math.max(0, 100 - Math.min(100, (avgResidual / thresholds.clogging) * 100));
    setStabilityIndex(Math.round(stability));
  }, []);

  const computeDistribution = useCallback((values) => {
    const bins = { normal: 0, warning: 0, highRisk: 0, clogging: 0, flooding: 0 };
    if (!values || values.length === 0) {
      setDistribution({ normal: 0, warning: 0, danger: 0, critical: 0 });
      return;
    }
    values.forEach(v => {
      if (v < thresholds.normal) bins.normal++;
      else if (v < thresholds.warning) bins.warning++;
      else if (v < thresholds.highRisk) bins.highRisk++;
      else if (v < thresholds.clogging) bins.clogging++;
      else bins.flooding++;
    });
    // Map to existing state structure for backward compatibility
    setDistribution({
      normal: bins.normal,
      warning: bins.warning + bins.highRisk,
      danger: bins.clogging,
      critical: bins.flooding
    });
  }, []);

  // main process function — transforms and calculates analytics
  const processTurbidityData = useCallback((data) => {
    const formatted = data
      .map(item => ({
        time: new Date(item.created_at).toLocaleTimeString(),
        value: processSensorValue(item.value), // convert raw RTU -> NTU
        fullDate: new Date(item.created_at),
        date: new Date(item.created_at).toLocaleDateString(),
        id: item.id,
        originalValue: item.value // Store original raw RTU for debugging
      }))
      .reverse();
    const values = formatted.map(d => Number(d.value) || 0);
    const latest = values.length ? values[values.length - 1] : 0;
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const highest = values.length ? Math.max(...values) : 0;
    const trend = calculateTrend(values.slice(-10));
    const alert = determineAlertLevel(latest, average, trend);
    const risk = predictCloggingRisk(latest);
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
    const risk = predictCloggingRisk(latest);
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
          value: processSensorValue(item.value), // convert raw RTU -> NTU
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
    if (timeRange === 'month') {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      return (query) => query.gte('created_at', start);
    }
    // 'all' case - return query without any date filter
    return (query) => query;
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
        // Show empty state but don't set error - this is normal if no data yet
        setTurbidityData([]);
        // Only show error if it's not a fresh fetch (i.e., we've loaded before)
        if (turbidityDataRef.current.length > 0) {
          setError('No data found in turbidity_readings table for selected range');
        }
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

    // Poll for new DB rows frequently so the dashboard reflects ESP32 adaptive sampling quickly.
    // The ESP32 itself controls its sampling interval; dashboard polling is lightweight (5s).
    const intervalId = setInterval(() => {
      if (isLive) checkForNewData();
    }, 5000);

    return () => clearInterval(intervalId);
  }, [isLive, timeRange, fetchTurbidityData, checkForNewData]);

  // small helpers - aligned with ESP32 thresholds
  const getAlertConfig = (level) => {
    const configs = {
      normal: { color: 'green', icon: '✅', message: 'Clear Water - Normal sediment levels', bgColor: 'bg-green-100', borderColor: 'border-green-400', textColor: 'text-green-800' },
      warning: { color: 'yellow', icon: '🔸', message: 'Light Sediment - Silt accumulation begins', bgColor: 'bg-yellow-100', borderColor: 'border-yellow-400', textColor: 'text-yellow-800' },
      highRisk: { color: 'orange', icon: '🔶', message: 'Moderate Sediment - Significant sedimentation risk', bgColor: 'bg-orange-100', borderColor: 'border-orange-400', textColor: 'text-orange-800' },
      clogging: { color: 'red', icon: '🚨', message: 'Heavy Sediment - High probability of clogging', bgColor: 'bg-red-100', borderColor: 'border-red-400', textColor: 'text-red-800' },
      flooding: { color: 'darkred', icon: '💥', message: 'CRITICAL: FLOODING IMMINENT - EMERGENCY RESPONSE REQUIRED', bgColor: 'bg-red-200', borderColor: 'border-red-600', textColor: 'text-red-900' }
    };
    return configs[level] || configs.normal;
  };

  const getStatus = (v) => {
    if (v >= thresholds.flooding) return '💥 EXTREME - Flooding Imminent';
    if (v >= thresholds.clogging) return '🚨 VERY HIGH - Clogging Likely';
    if (v >= thresholds.highRisk) return '🔶 HIGH - Significant Risk';
    if (v >= thresholds.warning) return '🔸 MODERATE - Monitor Closely';
    return '✅ LOW - Clear Water';
  };

  const getStatusColor = (v) => {
    if (v >= thresholds.flooding) return 'text-red-900';
    if (v >= thresholds.clogging) return 'text-red-700';
    if (v >= thresholds.highRisk) return 'text-orange-600';
    if (v >= thresholds.warning) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getTrendIcon = (trend) => (trend === 'rising' ? '📈' : trend === 'falling' ? '📉' : '➡️');

  const toggleLiveUpdates = () => setIsLive(!isLive);

  // build insight summary for sediment monitoring - aligned with ESP32 logic
  const buildInsight = () => {
    if (!turbidityData || turbidityData.length < 2) return 'Collecting initial data from sediment sensor...';
    const rate = accumulationRate;
    const floodRisk = riskAssessment?.floodRisk || 'UNKNOWN';
    const sedimentLevel = riskAssessment?.sedimentLevel || 'UNKNOWN';
    
    const latestNTU = stats.latest || 0;
    if (latestNTU >= thresholds.flooding) {
      return `💥 CRITICAL: FLOODING IMMINENT (${latestNTU.toFixed(1)} NTU) - ${floodRisk} RISK. ${riskAssessment?.maintenance || 'Emergency response required immediately.'} Sampling rate: ${riskAssessment?.samplingInterval || 'Maximum'}`;
    }
    if (latestNTU >= thresholds.clogging) {
      return `🚨 ALERT: DRAINAGE CLOGGING LIKELY (${latestNTU.toFixed(1)} NTU) - ${floodRisk} RISK. Accumulation rate: ${rate} NTU/hr. ${daysToClog ? `Estimated blockage in ${daysToClog} days.` : ''} ${riskAssessment?.maintenance || 'Immediate action needed.'}`;
    }
    if (rate >= thresholds.clogging * 0.1) {
      return `⚠️ Rapid sediment accumulation detected (~${rate} NTU/hr) - ${sedimentLevel}. Flood Risk: ${floodRisk} — ${riskAssessment?.probability || ''}. ${daysToClog ? `Estimated clogging in ${daysToClog} days.` : ''} Schedule maintenance urgently.`;
    }
    if (rate > 0) {
      return `Sediment gradually accumulating (~${rate} NTU/hr) - ${sedimentLevel}. Flood Risk: ${floodRisk}. Stability index ${stabilityIndex}%. Monitor closely and plan routine cleaning.`;
    }
    if (rate < 0) {
      return `✅ Sediment levels decreasing (${Math.abs(rate)} NTU/hr) - ${sedimentLevel}. Drain recently cleaned or heavy rain flushed system. Flood Risk: ${floodRisk}. Stability index ${stabilityIndex}%. System functioning normally.`;
    }
    return `Stable drainage conditions - ${sedimentLevel}. Flood Risk: ${floodRisk}. Stability index ${stabilityIndex}%. Sidewalk drain operating normally.`;
  };

  // UI handlers
  const onTimeRangeChange = (range) => {
    setTimeRange(range);
  };

  // Print date range state
  const [printRange, setPrintRange] = useState({ start: null, end: null });
  const [showPrintModal, setShowPrintModal] = useState(false);

  // Print records function
  const handlePrint = (selectedRange = null) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow pop-ups to print records');
      return;
    }

    // Filter data by date range if provided
    let dataToUse = [...turbidityData];
    if (selectedRange && selectedRange.start && selectedRange.end) {
      const startDate = new Date(selectedRange.start);
      const endDate = new Date(selectedRange.end);
      console.log('Filtering between:', startDate, 'and', endDate);
      
      dataToUse = turbidityData.filter(record => {
        const recordDate = new Date(record.fullDate);
        const isInRange = recordDate >= startDate && recordDate <= endDate;
        return isInRange;
      });
      
      console.log('Filtered from', turbidityData.length, 'to', dataToUse.length, 'records');
    }
    const filteredData = dataToUse;

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
             <h1>Sediment Monitoring Report</h1>
             <p>Generated: ${new Date().toLocaleString()}</p>
             <p>Time Range: ${selectedRange ? `${new Date(selectedRange.start).toLocaleString()} to ${new Date(selectedRange.end).toLocaleString()}` : 'All Data'} | Total Records: ${selectedRange ? filteredData.length : turbidityData.length}</p>
           </div>          <div class="summary">
            <div class="summary-item">
              <strong>Latest Reading</strong>
              <span>${filteredData.length ? filteredData[filteredData.length - 1].value.toFixed(1) : 0} NTU</span>
            </div>
            <div class="summary-item">
              <strong>Average</strong>
              <span>${filteredData.length ? (filteredData.reduce((sum, record) => sum + record.value, 0) / filteredData.length).toFixed(1) : 0} NTU</span>
            </div>
            <div class="summary-item">
              <strong>Peak</strong>
              <span>${filteredData.length ? Math.max(...filteredData.map(d => d.value)).toFixed(1) : 0} NTU</span>
            </div>
            <div class="summary-item">
              <strong>Trend</strong>
              <span>${calculateTrend(filteredData.map(d => d.value))}</span>
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
          <div style="margin: 20px 0; padding: 15px; background: ${alertLevel === 'flooding' || alertLevel === 'clogging' ? '#fee' : alertLevel === 'highRisk' ? '#fff3e0' : '#fff8e1'}; border-left: 4px solid ${alertLevel === 'flooding' || alertLevel === 'clogging' ? 'red' : alertLevel === 'highRisk' ? 'orange' : 'yellow'};">
            <strong>Risk Assessment:</strong> ${riskAssessment.risk}<br>
            <strong>Flood Risk:</strong> ${riskAssessment.floodRisk || 'N/A'}<br>
            <strong>Sediment Level:</strong> ${riskAssessment.sedimentLevel || 'N/A'}<br>
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
              ${filteredData.map((record, index) => {
                let statusClass = 'status-normal';
                let statusText = 'Clear Water';
                if (record.value >= thresholds.flooding) {
                  statusClass = 'status-critical';
                  statusText = 'Flooding Risk';
                } else if (record.value >= thresholds.clogging) {
                  statusClass = 'status-critical';
                  statusText = 'Clogging Risk';
                } else if (record.value >= thresholds.highRisk) {
                  statusClass = 'status-danger';
                  statusText = 'High Risk';
                } else if (record.value >= thresholds.warning) {
                  statusClass = 'status-warning';
                  statusText = 'Warning';
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
            <p>Thresholds: Normal (&lt;${thresholds.normal} NTU), Warning (${thresholds.normal}–${thresholds.warning} NTU), High Risk (${thresholds.warning}–${thresholds.highRisk} NTU), Clogging (${thresholds.highRisk}–${thresholds.clogging} NTU), Flooding (&gt;=${thresholds.flooding} NTU)</p>
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
          <div className="text-xl text-gray-600 mb-2">Loading Sediment Monitoring System...</div>
          <div className="text-sm text-gray-500">Connecting to ESP32 sensor...</div>
        </div>
      </div>
    );
  }

  const alertConfig = getAlertConfig(alertLevel);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Top-left fixed controls: theme toggle + logout */}
      <div className="fixed top-4 left-4 z-50 flex items-center space-x-3">
        <button
          onClick={toggleTheme}
          aria-pressed={isDark}
          aria-label="Toggle theme"
          className={`btn btn-toggle ${isDark ? 'dark' : 'light'}`}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <span className="icon" aria-hidden="true">
            {isDark ? (
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" fill="currentColor"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
          </span>
          <span className="text-xs">{isDark ? 'Dark' : 'Light'}</span>
        </button>

        <button
          onClick={handleLogout}
          aria-label="Logout"
          className="btn btn-logout"
          title="Sign out"
        >
          <span className="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M13 19H6a2 2 0 01-2-2V7a2 2 0 012-2h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          <span className="text-xs">Logout</span>
        </button>
      </div>
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
  {checkSensorCalibration(turbidityData.length > 0 ? turbidityData.map(d => ({value: d.originalValue ?? d.value})) : []) && (
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
              <span>
                <strong>Monitoring:</strong> Sediment Accumulation | ESP32 Sensor Active |
                <span className="ml-1">Update Frequency: {riskAssessment?.samplingInterval ?? 'Adaptive (ESP32-controlled)'}</span>
              </span>
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

          {/* theme toggle moved to fixed top-left controls */}

          <div className="flex items-center space-x-3">
            <div className="text-xs text-gray-600 mr-2">Range:</div>
            <div className="flex space-x-2">
              <button onClick={() => onTimeRangeChange('today')} className={`px-3 py-1 rounded ${timeRange === 'today' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Today</button>
              <button onClick={() => onTimeRangeChange('week')} className={`px-3 py-1 rounded ${timeRange === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Week</button>
              <button onClick={() => onTimeRangeChange('month')} className={`px-3 py-1 rounded ${timeRange === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Month</button>
              <button onClick={() => onTimeRangeChange('all')} className={`px-3 py-1 rounded ${timeRange === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>All</button>
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
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div><strong>Flood Risk:</strong> <span className="ml-2 font-semibold">{riskAssessment?.floodRisk ?? 'N/A'}</span></div>
                <div><strong>Timeframe:</strong> <span className="ml-2">{riskAssessment?.timeframe ?? 'N/A'}</span></div>
                <div><strong>Probability:</strong> <span className="ml-2">{riskAssessment?.probability ?? 'N/A'}</span></div>
                <div><strong>Sediment:</strong> <span className="ml-2">{riskAssessment?.sedimentLevel ?? 'N/A'}</span></div>
              </div>
              <div className="mt-2 text-sm">
                <strong>Action Required:</strong> <span className="ml-2">{riskAssessment?.action ?? 'N/A'}</span>
              </div>

              <p className="text-sm mt-2">
                <strong>Current Reading:</strong> {(stats.latest || 0).toFixed(1)} NTU — <strong>Flood Risk:</strong> {riskAssessment?.floodRisk || 'N/A'} | <strong>Sediment Level:</strong> {riskAssessment?.sedimentLevel || 'N/A'}
              </p>
              {riskAssessment?.maintenance && (
                <p className="text-sm mt-2 font-semibold">
                  <strong>Maintenance Action:</strong> {riskAssessment.maintenance}
                </p>
              )}
              {riskAssessment?.samplingInterval && (
                <p className="text-xs mt-1 text-gray-600">
                  <strong>ESP32 Sampling:</strong> {riskAssessment.samplingInterval}
                </p>
              )}
            </div>
          </div>
        </div>

        <h1 className="text-3xl font-semibold text-gray-800 mb-2">Sediment Monitoring System</h1>
        <p className="text-gray-600 mb-6">Real-time turbidity monitoring for sediment accumulation tracking</p>

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
            <h3 className="text-lg font-semibold mb-4">Sediment Turbidity Timeline</h3>
            {turbidityData.length > 0 ? (
              <div style={{ width: '100%', height: 360 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={turbidityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" minTickGap={20} />
                    <YAxis label={{ value: 'NTU', angle: -90, position: 'insideLeft' }} />
                    <ReferenceLine y={thresholds.normal} stroke="green" label={`Normal (${thresholds.normal})`} />
                    <ReferenceLine y={thresholds.warning} stroke="orange" label={`Warning (${thresholds.warning})`} />
                    <ReferenceLine y={thresholds.highRisk} stroke="orangered" label={`High Risk (${thresholds.highRisk})`} />
                    <ReferenceLine y={thresholds.clogging} stroke="red" label={`Clogging (${thresholds.clogging})`} />
                    <ReferenceLine y={thresholds.flooding} stroke="darkred" strokeDasharray="5 5" label={`Flooding (${thresholds.flooding})`} />
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
                    { name: `0-${Math.max(0, Math.floor(thresholds.normal - 1))}`, count: distribution.normal },
                    { name: `${thresholds.normal}-${Math.max(thresholds.warning - 1, thresholds.normal)}`, count: Math.floor(distribution.warning / 2) },
                    { name: `${thresholds.warning}-${Math.max(thresholds.highRisk - 1, thresholds.warning)}`, count: Math.floor(distribution.warning / 2) },
                    { name: `${thresholds.highRisk}-${Math.max(thresholds.clogging - 1, thresholds.highRisk)}`, count: distribution.danger },
                    { name: `${thresholds.clogging}+`, count: distribution.critical }
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#7c3aed" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-xs text-gray-500 mt-2">Distribution of readings showing sediment levels in the water.</div>
            </div>

            <div className="bg-white p-6 rounded shadow">
              <h3 className="text-lg font-semibold mb-4">Debris Accumulation Rate (Δ NTU/hr)</h3>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={turbidityData.map((d, i, arr) => {
                    if (i === 0) return { time: d.time, rate: 0 };
                    const prev = arr[i - 1];
                    let dtHours = (new Date(d.fullDate) - new Date(prev.fullDate)) / 3600000;
                    // Clamp to avoid division by tiny gaps; minimum 5 seconds equivalent
                    if (!dtHours || dtHours < (5/3600)) dtHours = 5/3600;
                    let diff = (d.value - prev.value) / dtHours;
                    // Avoid artificial -200 floor; allow larger negative (clearing) values but cap extremes
                    if (diff < -10000) diff = -10000;
                    if (diff > thresholds.flooding * 2) diff = thresholds.flooding * 2;
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
            onClick={() => setShowPrintModal(true)}
            disabled={turbidityData.length === 0}
            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium py-3 px-8 rounded shadow inline-flex items-center"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
            Print Records
          </button>
        </div>

        {/* Print Modal */}
        {showPrintModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
              <div className="mt-3">
                <h3 className="text-lg font-semibold">Select Date Range for Print</h3>
                <div className="mt-4">
                  <div className="mb-4">
                    <label className="block text-sm text-gray-700 mb-2">Start Date & Time</label>
                    <div className="flex space-x-2">
                      <input
                        type="datetime-local"
                        className="w-full p-2 border rounded"
                        onChange={(e) => setPrintRange(prev => ({ ...prev, start: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm text-gray-700 mb-2">End Date & Time</label>
                    <div className="flex space-x-2">
                      <input
                        type="datetime-local"
                        className="w-full p-2 border rounded"
                        onChange={(e) => setPrintRange(prev => ({ ...prev, end: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    onClick={() => setShowPrintModal(false)}
                    className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (printRange.start && printRange.end) {
                        handlePrint(printRange);
                        setShowPrintModal(false);
                      }
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-300"
                    disabled={!printRange.start || !printRange.end}
                  >
                    Print
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
