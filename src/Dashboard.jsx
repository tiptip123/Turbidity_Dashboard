import { useState, useEffect, useRef } from 'react';
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
  
  const lastDataId = useRef(0);
  const chartDataRef = useRef([]);

  // Threshold configuration
  const thresholds = {
    normal: 1500,
    warning: 2000,
    danger: 3000,
    critical: 5000
  };

  useEffect(() => {
    fetchTurbidityData();
    
    // Set up polling interval (reduced from 5s to 10s)
    const intervalId = setInterval(() => {
      if (isLive) {
        checkForNewData();
      }
    }, 10000); // Changed from 5000 to 10000

    // Cleanup on component unmount
    return () => {
      clearInterval(intervalId);
    };
  }, [isLive]);

  // Check for new data without full refresh
  const checkForNewData = async () => {
    try {
      // Get only the most recent entry to check if there's new data
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
        
        // If we have new data, fetch only the new data
        if (latestId > lastDataId.current) {
          console.log('New data detected, fetching incrementally...');
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
        // Process and append new data
        const newDataPoints = data.map(item => ({
          time: new Date(item.created_at).toLocaleTimeString(),
          value: item.value,
          fullDate: new Date(item.created_at),
          date: new Date(item.created_at).toLocaleDateString(),
          id: item.id
        }));

        // Update the last known ID
        lastDataId.current = data[data.length - 1].id;
        
        // Append new data to existing data (limit to 100 points)
        const updatedData = [...turbidityData, ...newDataPoints];
        if (updatedData.length > 100) {
          updatedData.splice(0, updatedData.length - 100); // Keep only the latest 100 points
        }
        
        // Update state with the new data
        setTurbidityData(updatedData);
        chartDataRef.current = updatedData;
        
        // Update statistics incrementally
        updateStatsIncrementally(updatedData);
        
        // Show new data alert
        setNewDataAlert(true);
        setLastUpdate(new Date());
        
        // Auto-dismiss alert after 5 seconds
        setTimeout(() => {
          setNewDataAlert(false);
        }, 5000);
      }
    } catch (error) {
      console.error('Error processing new data:', error);
    }
  };

  const fetchTurbidityData = async () => {
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
        // Store the latest ID for change detection
        lastDataId.current = data[0].id;
        processTurbidityData(data);
        setLastUpdate(new Date());
      } else {
        setError('No data found in turbidity_readings table');
      }
    } catch (error) {
      console.error('Error:', error);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const processTurbidityData = (data) => {
    const formattedData = data.map(item => ({
      time: new Date(item.created_at).toLocaleTimeString(),
      value: item.value,
      fullDate: new Date(item.created_at),
      date: new Date(item.created_at).toLocaleDateString(),
      id: item.id
    })).reverse();

    const values = data.map(item => item.value);
    const latest = values[0];
    const average = values.reduce((sum, val) => sum + val, 0) / values.length;
    const highest = Math.max(...values);
    const trend = calculateTrend(values.slice(0, 10));
    const alert = determineAlertLevel(latest, average, trend);

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

  // Update statistics incrementally without recalculating everything
  const updateStatsIncrementally = (data) => {
    if (data.length === 0) return;
    
    const values = data.map(item => item.value);
    const latest = values[values.length - 1];
    const highest = Math.max(stats.highest, latest);
    
    // Calculate average incrementally (more efficient for large datasets)
    const newAverage = (stats.average * turbidityData.length + latest) / (turbidityData.length + 1);
    
    // Calculate trend based on recent values
    const recentValues = values.slice(-10);
    const trend = calculateTrend(recentValues);
    
    const alert = determineAlertLevel(latest, newAverage, trend);

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

  const determineAlertLevel = (latest, average, trend) => {
    if (latest >= thresholds.critical || average >= thresholds.critical) {
      return 'critical';
    } else if (latest >= thresholds.danger || average >= thresholds.danger) {
      return trend === 'rising' ? 'critical' : 'danger';
    } else if (latest >= thresholds.warning || average >= thresholds.warning) {
      return trend === 'rising' ? 'danger' : 'warning';
    } else if (latest >= thresholds.normal || average >= thresholds.normal) {
      return trend === 'rising' ? 'warning' : 'normal';
    }
    return 'normal';
  };

  const getAlertConfig = (level) => {
    const configs = {
      normal: { color: 'green', icon: '✅', message: 'Normal sediment levels' },
      warning: { color: 'yellow', icon: '⚠️', message: 'Elevated sediments - Monitor closely' },
      danger: { color: 'orange', icon: '🚨', message: 'High sediment levels - Flood risk increasing' },
      critical: { color: 'red', icon: '🔥', message: 'CRITICAL: Immediate action required - High flood risk' }
    };
    return configs[level] || configs.normal;
  };

  const getStatus = (value) => {
    if (value >= thresholds.critical) return '🔥 Critical';
    if (value >= thresholds.danger) return '🚨 Danger';
    if (value >= thresholds.warning) return '⚠️ Warning';
    return '✅ Normal';
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

  const predictCloggingRisk = () => {
    const { latest, average, trend } = stats;
    const alertConfig = getAlertConfig(alertLevel);
    
    if (alertLevel === 'critical') {
      return 'IMMEDIATE ACTION: High risk of clogging and flooding. Evacuation may be necessary.';
    } else if (alertLevel === 'danger') {
      return 'HIGH RISK: Sediment buildup detected. Flood likely within 24-48 hours if trend continues.';
    } else if (alertLevel === 'warning') {
      return 'MODERATE RISK: Increasing sediments. Monitor closely for rapid changes.';
    }
    return 'LOW RISK: Normal sediment levels. Continue regular monitoring.';
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
          <button
            onClick={toggleLiveUpdates}
            className={`px-3 py-1 rounded text-sm ${
              isLive ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
            } text-white`}
          >
            {isLive ? 'Pause' : 'Resume'}
          </button>
        </div>

        {/* New Data Alert (dismissible) */}
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
        <div className={`bg-${alertConfig.color}-100 border border-${alertConfig.color}-400 text-${alertConfig.color}-800 px-6 py-4 rounded-lg mb-6`}>
          <div className="flex items-center">
            <span className="text-2xl mr-3">{alertConfig.icon}</span>
            <div>
              <h2 className="text-xl font-bold">Flood Alert: {alertConfig.message}</h2>
              <p className="text-sm mt-1">{predictCloggingRisk()}</p>
            </div>
          </div>
        </div>

        <h1 className="text-3xl font-bold text-gray-800 mb-8">Real-time Flood Monitoring Dashboard</h1>
        
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            <p className="font-semibold">Error:</p>
            <p>{error}</p>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          {/* Alert Level Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Alert Level</h2>
            <div className="text-center">
              <span className={`text-3xl font-bold ${getStatusColor(stats.latest)}`}>
                {alertLevel.toUpperCase()}
              </span>
              <p className="text-sm text-gray-500 mt-2">{alertConfig.message}</p>
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
          </div>
        </div>

        {/* Chart Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-6">Sediment Monitoring Timeline</h2>
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
                <p className="text-sm">Waiting for sediment monitoring data...</p>
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