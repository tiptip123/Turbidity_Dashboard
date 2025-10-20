import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  BarChart, Bar
} from 'recharts';

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

  // REAL-WORLD DRAINAGE WATER TURBIDITY THRESHOLDS
  const thresholds = {
    normal: 100,    // Clear water
    warning: 500,   // Moderate sediment
    danger: 1000,   // High sediment
    critical: 1500  // Extreme sediment
  };

  // Risk prediction (keeps your existing messaging)
  const predictCloggingRisk = (latest, average, trend, currentAlertLevel) => {
    if (currentAlertLevel === 'critical' || latest >= thresholds.critical) {
      return {
        risk: 'EXTREME',
        timeframe: 'IMMEDIATE (1-3 hours)',
        action: 'CLEAR DRAINS: Extreme sediment levels - Immediate clogging risk',
        probability: '80-95%',
        consequences: 'Drainage system will clog rapidly'
      };
    } else if (currentAlertLevel === 'danger' || latest >= thresholds.danger) {
      return {
        risk: 'HIGH',
        timeframe: '6-24 hours',
        action: 'PREPARE CLEANING: High sediment - Schedule drain cleaning',
        probability: '60-80%',
        consequences: 'Significant sediment accumulation occurring'
      };
    } else if (currentAlertLevel === 'warning' || latest >= thresholds.warning) {
      return {
        risk: 'MODERATE',
        timeframe: '2-7 days if trend continues',
        action: 'INCREASE MONITORING: Moderate sediment levels',
        probability: '30-60%',
        consequences: 'Sediment buildup starting'
      };
    }
    return {
      risk: 'LOW',
      timeframe: 'No immediate threat',
      action: 'NORMAL: Continue routine monitoring',
      probability: '5-15%',
      consequences: 'Normal drainage flow'
    };
  };

  // calibration check (logs to console; also shows UI notice when avg too high)
  const checkSensorCalibration = (readings) => {
    if (!readings || readings.length === 0) return;
    const avgReading = readings.reduce((sum, val) => sum + val.value, 0) / readings.length;
    if (avgReading > 2000) {
      console.warn('⚠️ SENSOR CALIBRATION WARNING: avg:', avgReading);
    }
  };

  // quick inversion if sensor returns inverse mapping
  const invertIfNeeded = (value) => {
    const SENSOR_MAX = 3000;
    // If it's clearly inverted in practice, this line flips it.
    return SENSOR_MAX - value;
  };

  // Build a Supabase date filter based on the timeRange
  const buildDateFilter = () => {
    const now = new Date();
    if (timeRange === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
      return (query) => query.gte('created_at', start);
    }
    if (timeRange === 'week') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      return (query) => query.gte('created_at', start);
    }
    // month
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return (query) => query.gte('created_at', start);
  };

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
  }, [timeRange]);

  useEffect(() => {
    fetchTurbidityData();

    const intervalId = setInterval(() => {
      if (isLive) checkForNewData();
    }, 10000);

    return () => clearInterval(intervalId);
  }, [isLive, fetchTurbidityData]);

  // check for newest row
  const checkForNewData = async () => {
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
  };

  // fetch only new rows since last id
  const fetchNewData = async (sinceId) => {
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
          value: invertIfNeeded(item.value),
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
  };

  // main process function — transforms and calculates analytics
  const processTurbidityData = (data) => {
    // map + invert + reverse (so chronological ascending)
    const formatted = data
      .map(item => ({
        time: new Date(item.created_at).toLocaleTimeString(),
        value: invertIfNeeded(item.value),
        fullDate: new Date(item.created_at),
        date: new Date(item.created_at).toLocaleDateString(),
        id: item.id,
        originalValue: item.value
      }))
      .reverse();

    // compute stats
    const values = formatted.map(d => Number(d.value) || 0);
    const latest = values.length ? values[values.length - 1] : 0;
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const highest = values.length ? Math.max(...values) : 0;
    const trend = calculateTrend(values.slice(-10));
    const alert = determineAlertLevel(latest, average, trend);
    const risk = predictCloggingRisk(latest, average, trend, alert);

    // accumulation analytics
    computeAccumulationMetrics(formatted);

    // distribution
    computeDistribution(values);

    setTurbidityData(formatted.slice(-1000));
    chartDataRef.current = formatted.slice(-1000);
    setStats({ latest, average: Math.round(average), highest, trend });
    setAlertLevel(alert);
    setRiskAssessment(risk);
  };

  // incremental update for small inserts
  const updateStatsIncrementally = (data) => {
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
  };

  // accumulation metrics: rate, days to clog, stability
  const computeAccumulationMetrics = (formatted) => {
    // need at least two points
    if (!formatted || formatted.length < 2) {
      setAccumulationRate(0);
      setDaysToClog(null);
      setStabilityIndex(100);
      return;
    }

    // compute slope over last N points (e.g., last 6)
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
      const rate = dntu / dtHours; // NTU per hour
      totalRate += rate;
      used++;
    }

    const avgRate = used ? totalRate / used : 0; // NTU/hour (can be negative)
    setAccumulationRate(Number(avgRate.toFixed(2)));

    // predict days to critical (only if trending upwards)
    const current = formatted[formatted.length - 1].value;
    if (avgRate > 0) {
      const ntuLeft = thresholds.critical - current;
      const hoursToClog = ntuLeft > 0 ? (ntuLeft / avgRate) : 0;
      setDaysToClog(hoursToClog > 0 ? Number((hoursToClog / 24).toFixed(1)) : 0);
    } else {
      setDaysToClog(null);
    }

    // stability index: 100 - (relative std-like fraction)
    // approximate: stability = 100 - clamp(|avgRate| / critical * 100)
    const stability = Math.max(0, 100 - Math.min(100, Math.abs(avgRate) / thresholds.critical * 100));
    setStabilityIndex(Math.round(stability));
  };

  // distribution histogram counts
  const computeDistribution = (values) => {
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
  };

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

  const determineAlertLevel = (latest, average, trend) => {
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
  };

  // small helpers
  const getAlertConfig = (level) => {
    const configs = {
      normal: { color: 'green', icon: '✅', message: 'Clear water - Normal conditions', bgColor: 'bg-green-100', borderColor: 'border-green-400', textColor: 'text-green-800' },
      warning: { color: 'yellow', icon: '⚠️', message: 'Slight turbidity - Monitor closely', bgColor: 'bg-yellow-100', borderColor: 'border-yellow-400', textColor: 'text-yellow-800' },
      danger: { color: 'orange', icon: '🚨', message: 'Moderate turbidity - Flood risk increasing', bgColor: 'bg-orange-100', borderColor: 'border-orange-400', textColor: 'text-orange-800' },
      critical: { color: 'red', icon: '🔥', message: 'High turbidity - Immediate action required', bgColor: 'bg-red-100', borderColor: 'border-red-400', textColor: 'text-red-800' }
    };
    return configs[level] || configs.normal;
  };

  const getStatus = (v) => {
    if (v >= thresholds.critical) return '🔥 Critical Turbidity';
    if (v >= thresholds.danger) return '🚨 High Turbidity';
    if (v >= thresholds.warning) return '⚠️ Moderate Turbidity';
    return '✅ Clear Water';
  };

  const getStatusColor = (v) => {
    if (v >= thresholds.critical) return 'text-red-700';
    if (v >= thresholds.danger) return 'text-orange-600';
    if (v >= thresholds.warning) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getTrendIcon = (trend) => (trend === 'rising' ? '📈' : trend === 'falling' ? '📉' : '➡️');

  const toggleLiveUpdates = () => setIsLive(!isLive);

  // build AI-like insight summary
  const buildInsight = () => {
    if (!turbidityData || turbidityData.length < 2) return 'Waiting for more data to generate insights.';
    const rate = accumulationRate;
    if (rate >= thresholds.critical * 0.1) {
      return `Sediment accumulation is rising quickly (~${rate} NTU/hr). High clogging risk — ${riskAssessment?.probability || ''}. ${daysToClog ? `Estimated clogging in ${daysToClog} days.` : ''}`;
    }
    if (rate > 0) {
      return `Sediment slowly increasing (~${rate} NTU/hr). Monitor the drains; stability index ${stabilityIndex}%.`;
    }
    if (rate < 0) {
      return `Sediment levels decreasing (cleaning/flush effect). Stability index ${stabilityIndex}%.`;
    }
    return `Stable sediment levels. Stability index ${stabilityIndex}%.`;
  };

  // UI handlers
  const onTimeRangeChange = (range) => {
    setTimeRange(range);
  };

  // small loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading real-time sediment analytics...</div>
      </div>
    );
  }

  const alertConfig = getAlertConfig(alertLevel);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Sensor Calibration Notice */}
        {stats.latest > 2000 && (
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded-lg mb-4">
            <div className="flex items-center">
              <span className="text-xl mr-2">🔧</span>
              <div>
                <strong>Sensor Calibration Notice:</strong>
                <p className="text-sm">
                  Current sensor average is high — check sensor wiring/calibration.
                </p>
              </div>
            </div>
          </div>
        )}

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
                <strong>Current Reading:</strong> {stats.latest} NTU — {stats.latest < thresholds.normal ? 'Clear Water' : 'Turbid Water'}
              </p>
            </div>
          </div>
        </div>

        <h1 className="text-3xl font-semibold text-gray-800 mb-6">Sediment & Turbidity Dashboard</h1>

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
            <h3 className="font-semibold text-gray-700 mb-2">Accumulation Rate</h3>
            <div className="text-3xl font-bold text-indigo-600">{accumulationRate} NTU/hr</div>
            <div className="text-xs text-gray-500 mt-1">Recent average rate (positive = increasing)</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="font-semibold text-gray-700 mb-2">Days to Clog (est.)</h3>
            <div className="text-3xl font-bold text-red-600">{daysToClog !== null ? `${daysToClog} days` : 'Stable'}</div>
            <div className="text-xs text-gray-500 mt-1">Estimate based on current rate & critical threshold</div>
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
            <h3 className="text-lg font-semibold mb-4">Turbidity Monitoring Timeline</h3>
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
              <h3 className="text-lg font-semibold mb-4">Sediment Distribution</h3>
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
              <div className="text-xs text-gray-500 mt-2">Shows how many readings fall into each turbidity range.</div>
            </div>

            <div className="bg-white p-6 rounded shadow">
              <h3 className="text-lg font-semibold mb-4">Accumulation Rate (Δ NTU)</h3>
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
              <div className="text-xs text-gray-500 mt-2">Positive = sediment increasing; Negative = decreasing</div>
            </div>
          </div>
        </div>

        {/* manual refresh */}
        <div className="flex justify-center">
          <button onClick={fetchTurbidityData} className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-8 rounded shadow inline-flex items-center">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581" /></svg>
            Manual Refresh
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
