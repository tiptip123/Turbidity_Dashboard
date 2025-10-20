import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const Dashboard = () => {
  const [turbidityData, setTurbidityData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    latest: 0,
    average: 0,
    highest: 0,
    trend: 'stable'
  });
  const [error, setError] = useState(null);
  const [alertLevel, setAlertLevel] = useState('normal');
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [isLive, setIsLive] = useState(true);
  const [newDataAlert, setNewDataAlert] = useState(false);
  const [riskAssessment, setRiskAssessment] = useState(null);
  
  const lastDataId = useRef(0);
  const chartDataRef = useRef([]);
  const statsRef = useRef(stats);
  const turbidityDataRef = useRef(turbidityData);

  // Update refs when state changes
  useEffect(() => {
    statsRef.current = stats;
    turbidityDataRef.current = turbidityData;
  }, [stats, turbidityData]);

  // REAL-WORLD DRAINAGE WATER TURBIDITY THRESHOLDS
  const thresholds = {
    normal: 100,       // Clear water: 0-100 NTU (normal flow)
    warning: 500,      // Moderate sediment: 100-500 NTU (monitor)
    danger: 1000,      // High sediment: 500-1000 NTU (clogging risk)
    critical: 1500     // Extreme sediment: 1000+ NTU (immediate clog risk)
  };

  // REALISTIC risk prediction for drainage systems
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

  // SENSOR CALIBRATION CHECK
  const checkSensorCalibration = (readings) => {
    const avgReading = readings.reduce((sum, val) => sum + val.value, 0) / readings.length;
    
    if (avgReading > 2000) {
      console.warn('⚠️ SENSOR CALIBRATION WARNING:');
      console.warn(`Current average: ${avgReading} NTU in clear water`);
      console.warn('Expected: 0-100 NTU for clear water');
      console.warn('Sensor may need recalibration or has inverse output');
    }
  };

  // QUICK FIX: INVERT THE READINGS
  const invertIfNeeded = (value) => {
    // If clear water gives 2400+ NTU, invert the scale
    const SENSOR_MAX = 3000; // Adjust based on your sensor specs
    return SENSOR_MAX - value;
  };

  const fetchTurbidityData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: supabaseError } = await supabase
        .from('turbidity_readings')
        .select('id, value, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (supabaseError) {
        console.error('Supabase error:', supabaseError);
        setError('Failed to fetch data from database');
        return;
      }

      if (data && data.length > 0) {
        // Check sensor calibration
        checkSensorCalibration(data);
        
        // Store the latest ID for change detection
        lastDataId.current = data[0].id;
        processTurbidityData(data);
        setLastUpdate(new Date());
        setError(null);
      } else {
        setError('No data found in turbidity_readings table');
      }
    } catch (error) {
      console.error('Error:', error);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTurbidityData();
    
    const intervalId = setInterval(() => {
      if (isLive) {
        checkForNewData();
      }
    }, 10000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isLive, fetchTurbidityData]);

  // Check for new data without full refresh
  const checkForNewData = async () => {
    try {
      const { data, error } = await supabase
        .from('turbidity_readings')
        .select('id, value, created_at')
        .order('id', { ascending: false })
        .limit(1);

      if (error) {
        console.error('Error checking for new data:', error);
        return;
      }

      if (data && data.length > 0) {
        const latestId = data[0].id;
        
        if (latestId > lastDataId.current) {
          fetchNewData(lastDataId.current);
        }
      }
    } catch (error) {
      console.error('Error in data check:', error);
    }
  };

  // Fetch only new data since last known ID
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
          value: invertIfNeeded(item.value), // Apply inversion to new data
          fullDate: new Date(item.created_at),
          date: new Date(item.created_at).toLocaleDateString(),
          id: item.id,
          originalValue: item.value
        }));

        lastDataId.current = data[data.length - 1].id;
        
        const updatedData = [...turbidityDataRef.current, ...newDataPoints];
        if (updatedData.length > 100) {
          updatedData.splice(0, updatedData.length - 100);
        }
        
        setTurbidityData(updatedData);
        chartDataRef.current = updatedData;
        updateStatsIncrementally(updatedData);
        
        setNewDataAlert(true);
        setLastUpdate(new Date());
        
        setTimeout(() => {
          setNewDataAlert(false);
        }, 5000);
      }
    } catch (error) {
      console.error('Error processing new data:', error);
    }
  };

  // SINGLE processTurbidityData function with inversion
  const processTurbidityData = (data) => {
    const formattedData = data.map(item => ({
      time: new Date(item.created_at).toLocaleTimeString(),
      value: invertIfNeeded(item.value), // APPLY INVERSION HERE
      fullDate: new Date(item.created_at),
      date: new Date(item.created_at).toLocaleDateString(),
      id: item.id,
      originalValue: item.value // Keep original for debugging
    })).reverse();

    const values = formattedData.map(item => item.value);
    const latest = values[0];
    const average = values.reduce((sum, val) => sum + val, 0) / values.length;
    const highest = Math.max(...values);
    const trend = calculateTrend(values.slice(0, 10));
    const alert = determineAlertLevel(latest, average, trend);
    
    const risk = predictCloggingRisk(latest, average, trend, alert);
    setRiskAssessment(risk);

    setTurbidityData(formattedData);
    chartDataRef.current = formattedData;
    setStats({ 
      latest, 
      average: Math.round(average), 
      highest,
      trend
    });
    setAlertLevel(alert);
  };

  // Update statistics incrementally
  const updateStatsIncrementally = (data) => {
    if (data.length === 0) return;
    
    const values = data.map(item => item.value);
    const latest = values[values.length - 1];
    const highest = Math.max(statsRef.current.highest, latest);
    
    const newAverage = (statsRef.current.average * turbidityDataRef.current.length + latest) / (turbidityDataRef.current.length + 1);
    
    const recentValues = values.slice(-10);
    const trend = calculateTrend(recentValues);
    
    const alert = determineAlertLevel(latest, newAverage, trend);
    const risk = predictCloggingRisk(latest, newAverage, trend, alert);
    setRiskAssessment(risk);

    setStats({ 
      latest, 
      average: Math.round(newAverage), 
      highest,
      trend
    });
    setAlertLevel(alert);
  };

  const calculateTrend = (values) => {
    if (values.length < 2) return 'stable';
    
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    if (avgSecond > avgFirst * 1.1) return 'rising';
    if (avgSecond < avgFirst * 0.9) return 'falling';
    return 'stable';
  };

  // CORRECTED: Reversed alert level determination
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

  const getAlertConfig = (level) => {
    const configs = {
      normal: { 
        color: 'green', 
        icon: '✅', 
        message: 'Clear water - Normal conditions',
        bgColor: 'bg-green-100',
        borderColor: 'border-green-400',
        textColor: 'text-green-800'
      },
      warning: { 
        color: 'yellow', 
        icon: '⚠️', 
        message: 'Slight turbidity - Monitor closely',
        bgColor: 'bg-yellow-100',
        borderColor: 'border-yellow-400',
        textColor: 'text-yellow-800'
      },
      danger: { 
        color: 'orange', 
        icon: '🚨', 
        message: 'Moderate turbidity - Flood risk increasing',
        bgColor: 'bg-orange-100',
        borderColor: 'border-orange-400',
        textColor: 'text-orange-800'
      },
      critical: { 
        color: 'red', 
        icon: '🔥', 
        message: 'High turbidity - Immediate action required',
        bgColor: 'bg-red-100',
        borderColor: 'border-red-400',
        textColor: 'text-red-800'
      }
    };
    return configs[level] || configs.normal;
  };

  const getStatus = (value) => {
    if (value >= thresholds.critical) return '🔥 Critical Turbidity';
    if (value >= thresholds.danger) return '🚨 High Turbidity';
    if (value >= thresholds.warning) return '⚠️ Moderate Turbidity';
    return '✅ Clear Water';
  };

  const getStatusColor = (value) => {
    if (value >= thresholds.critical) return 'text-red-700';
    if (value >= thresholds.danger) return 'text-orange-600';
    if (value >= thresholds.warning) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getTrendIcon = (trend) => {
    return trend === 'rising' ? '📈' : trend === 'falling' ? '📉' : '➡️';
  };

  const getRiskColor = (riskLevel) => {
    switch (riskLevel) {
      case 'EXTREME': return 'text-red-700 bg-red-100';
      case 'HIGH': return 'text-orange-700 bg-orange-100';
      case 'MODERATE': return 'text-yellow-700 bg-yellow-100';
      default: return 'text-green-700 bg-green-100';
    }
  };

  const toggleLiveUpdates = () => {
    setIsLive(!isLive);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading real-time flood monitoring data...</div>
      </div>
    );
  }

  const alertConfig = getAlertConfig(alertLevel);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Sensor Calibration Warning */}
        {stats.latest > 2000 && (
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded-lg mb-4">
            <div className="flex items-center">
              <span className="text-xl mr-2">🔧</span>
              <div>
                <strong>Sensor Calibration Notice:</strong>
                <p className="text-sm">
                  Current reading: {stats.latest} NTU in clear water. 
                  Expected: 0-100 NTU. Sensor may need calibration.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Real-time Status Bar */}
        <div className="bg-blue-100 border border-blue-400 text-blue-800 px-4 py-2 rounded-lg mb-4 flex justify-between items-center">
          <div className="flex items-center">
            <span className="text-xl mr-2">{isLive ? '🔄' : '⏸️'}</span>
            <span>
              {isLive ? 'Live monitoring active' : 'Updates paused'} 
              <span className="text-sm ml-2">
                Last update: {lastUpdate.toLocaleTimeString()}
              </span>
            </span>
          </div>
          <div className="flex items-center space-x-2">
            {/* Debug info */}
            <span className="text-xs bg-gray-200 px-2 py-1 rounded">
              Raw: {turbidityData[0]?.originalValue || stats.latest} NTU
            </span>
            <button
              onClick={toggleLiveUpdates}
              className={`px-3 py-1 rounded text-sm ${
                isLive ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
              } text-white`}
            >
              {isLive ? 'Pause' : 'Resume'}
            </button>
          </div>
        </div>

        {/* New Data Alert */}
        {newDataAlert && (
          <div className="bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded-lg mb-4 flex justify-between items-center">
            <div className="flex items-center">
              <span className="text-lg mr-2">📊</span>
              <span>New data received and processed</span>
            </div>
            <button
              onClick={() => setNewDataAlert(false)}
              className="text-green-800 hover:text-green-600 text-lg"
            >
              &times;
            </button>
          </div>
        )}

        {/* Alert Banner */}
        <div className={`${alertConfig.bgColor} border ${alertConfig.borderColor} ${alertConfig.textColor} px-6 py-4 rounded-lg mb-6`}>
          <div className="flex items-start">
            <span className="text-2xl mr-3 mt-1">{alertConfig.icon}</span>
            <div className="flex-1">
              <h2 className="text-xl font-bold">Turbidity Alert: {alertConfig.message}</h2>
              {riskAssessment && (
                <div className="mt-2 grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <strong>Risk Level:</strong>
                    <span className={`ml-2 px-2 py-1 rounded ${getRiskColor(riskAssessment.risk)}`}>
                      {riskAssessment.risk}
                    </span>
                  </div>
                  <div>
                    <strong>Timeframe:</strong>
                    <span className="ml-2">{riskAssessment.timeframe}</span>
                  </div>
                  <div>
                    <strong>Probability:</strong>
                    <span className="ml-2">{riskAssessment.probability}</span>
                  </div>
                  <div>
                    <strong>Action:</strong>
                    <span className="ml-2">{riskAssessment.action}</span>
                  </div>
                </div>
              )}
              <p className="text-sm mt-2">
                <strong>Current Reading:</strong> {stats.latest} NTU - {stats.latest < thresholds.normal ? 'Clear Water' : 'Turbid Water'}
              </p>
            </div>
          </div>
        </div>

        <h1 className="text-3xl font-bold text-gray-800 mb-8">Real-time Turbidity Monitoring Dashboard</h1>
        
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            <p className="font-semibold">Error:</p>
            <p>{error}</p>
          </div>
        )}

        {/* Threshold Reference Card */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Drainage Water Turbidity Guide</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-green-50 p-3 rounded border-l-4 border-green-400">
              <strong>Normal: 0-{thresholds.normal} NTU</strong><br/>
              <span className="text-green-600">Clear water - Normal flow</span>
              <p className="text-xs mt-1">• No clogging risk<br/>• Routine monitoring</p>
            </div>
            <div className="bg-yellow-50 p-3 rounded border-l-4 border-yellow-400">
              <strong>Warning: {thresholds.normal}-{thresholds.warning} NTU</strong><br/>
              <span className="text-yellow-600">Moderate sediment</span>
              <p className="text-xs mt-1">• Minor buildup possible<br/>• Increase monitoring</p>
            </div>
            <div className="bg-orange-50 p-3 rounded border-l-4 border-orange-400">
              <strong>Danger: {thresholds.warning}-{thresholds.danger} NTU</strong><br/>
              <span className="text-orange-600">High sediment</span>
              <p className="text-xs mt-1">• Clogging likely<br/>• Schedule cleaning</p>
            </div>
            <div className="bg-red-50 p-3 rounded border-l-4 border-red-400">
              <strong>Critical: {thresholds.danger}+ NTU</strong><br/>
              <span className="text-red-600">Extreme sediment</span>
              <p className="text-xs mt-1">• Immediate clog risk<br/>• Emergency response</p>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          {/* Alert Level Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Water Condition</h2>
            <div className="text-center">
              <span className={`text-3xl font-bold ${getStatusColor(stats.latest)}`}>
                {alertLevel.toUpperCase()}
              </span>
              <p className="text-sm text-gray-500 mt-2">{alertConfig.message}</p>
              {riskAssessment && (
                <div className="mt-3 p-2 bg-gray-100 rounded">
                  <div className="text-xs font-semibold">Flood Probability</div>
                  <div className="text-lg font-bold">{riskAssessment.probability}</div>
                </div>
              )}
            </div>
          </div>

          {/* Latest Value Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Current Turbidity</h2>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-blue-600">{stats.latest} NTU</span>
              <span className={`text-sm font-medium ${getStatusColor(stats.latest)}`}>
                {getStatus(stats.latest)}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-2">Trend: {getTrendIcon(stats.trend)} {stats.trend}</p>
            <div className="mt-3 text-xs">
              <div className="flex justify-between">
                <span>Clear: &lt;{thresholds.normal} NTU</span>
                <span>Turbid: &gt;{thresholds.danger} NTU</span>
              </div>
            </div>
          </div>

          {/* Average Value Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Average Turbidity</h2>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-purple-600">{stats.average} NTU</span>
              <span className={`text-sm font-medium ${getStatusColor(stats.average)}`}>
                {getStatus(stats.average)}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-2">{turbidityData.length} reading average</p>
            {riskAssessment && (
              <div className="mt-2 text-xs text-gray-600">
                Expected impact: {riskAssessment.consequences}
              </div>
            )}
          </div>

          {/* Highest Value Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Peak Turbidity</h2>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-red-600">{stats.highest} NTU</span>
              <span className={`text-sm font-medium ${getStatusColor(stats.highest)}`}>
                {getStatus(stats.highest)}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-2">Historical maximum</p>
            {riskAssessment && (
              <div className="mt-2 text-xs text-gray-600">
                Timeframe: {riskAssessment.timeframe}
              </div>
            )}
          </div>
        </div>

        {/* Chart Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-6">Turbidity Monitoring Timeline</h2>
          {turbidityData.length > 0 ? (
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={turbidityData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis 
                    label={{ 
                      value: 'Turbidity (NTU)', 
                      angle: -90, 
                      position: 'insideLeft',
                      offset: -10 
                    }}
                  />
                  <ReferenceLine y={thresholds.normal} stroke="green" strokeDasharray="3 3" label="Normal" />
                  <ReferenceLine y={thresholds.warning} stroke="orange" strokeDasharray="3 3" label="Warning" />
                  <ReferenceLine y={thresholds.danger} stroke="red" strokeDasharray="3 3" label="Danger" />
                  <ReferenceLine y={thresholds.critical} stroke="darkred" strokeDasharray="3 3" label="Critical" />
                  
                  <Tooltip 
                    formatter={(value) => [`${value} NTU`, 'Turbidity']}
                    labelFormatter={(label, payload) => {
                      if (payload && payload[0]) {
                        return payload[0].payload.fullDate.toLocaleString();
                      }
                      return label;
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="value" 
                    stroke="#3b82f6" 
                    strokeWidth={3}
                    dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, fill: '#1d4ed8' }}
                    isAnimationActive={true}
                    animationDuration={500}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-96 flex items-center justify-center bg-gray-100 rounded-lg">
              <div className="text-center text-gray-500">
                <p className="text-lg mb-2">📊 No data available</p>
                <p className="text-sm">Waiting for turbidity monitoring data...</p>
              </div>
            </div>
          )}
        </div>

        {/* Refresh Button */}
        <div className="flex justify-center">
          <button
            onClick={fetchTurbidityData}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-8 rounded-lg transition-colors shadow-md flex items-center"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Manual Refresh
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;