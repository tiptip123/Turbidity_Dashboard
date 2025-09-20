import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const Dashboard = () => {
  const [turbidityData, setTurbidityData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    latest: 0,
    average: 0,
    highest: 0,
    trend: 'stable' // rising, falling, stable
  });
  const [error, setError] = useState(null);
  const [alertLevel, setAlertLevel] = useState('normal'); // normal, warning, danger, critical

  // Threshold configuration for flood prediction
  const thresholds = {
    normal: 1500,     // NTU - Normal sediment levels
    warning: 2000,    // NTU - Increased sediment, monitor closely
    danger: 3000,     // NTU - High sediment, flood risk increasing
    critical: 5000    // NTU - Critical levels, immediate action needed
  };

  useEffect(() => {
    fetchTurbidityData();
    // Refresh data every 5 minutes for real-time monitoring
    const interval = setInterval(fetchTurbidityData, 300000);
    return () => clearInterval(interval);
  }, []);

  const fetchTurbidityData = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: supabaseError } = await supabase
        .from('turbidity_readings')
        .select('value, created_at')
        .order('created_at', { ascending: false })
        .limit(100); // Get more data for trend analysis

      if (supabaseError) {
        console.error('Supabase error:', supabaseError);
        setError('Failed to fetch data from database');
        return;
      }

      if (data && data.length > 0) {
        const formattedData = data.map(item => ({
          time: new Date(item.created_at).toLocaleTimeString(),
          value: item.value,
          fullDate: new Date(item.created_at),
          date: new Date(item.created_at).toLocaleDateString()
        })).reverse();

        // Calculate statistics
        const values = data.map(item => item.value);
        const latest = values[0];
        const average = values.reduce((sum, val) => sum + val, 0) / values.length;
        const highest = Math.max(...values);

        // Calculate trend (rising, falling, stable)
        const recentValues = values.slice(0, 10); // Last 10 readings
        const trend = calculateTrend(recentValues);

        // Determine alert level based on thresholds and trend
        const alert = determineAlertLevel(latest, average, trend);

        setTurbidityData(formattedData);
        setStats({ 
          latest, 
          average: Math.round(average), 
          highest,
          trend
        });
        setAlertLevel(alert);
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading flood monitoring data...</div>
      </div>
    );
  }

  const alertConfig = getAlertConfig(alertLevel);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
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

        <h1 className="text-3xl font-bold text-gray-800 mb-8">Flood Monitoring Dashboard</h1>
        
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            <p className="font-semibold">Error:</p>
            <p>{error}</p>
          </div>
        )}

        {/* Stats Cards with Trend Analysis */}
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

        {/* Chart Section with Threshold Lines */}
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
                  {/* Threshold Lines */}
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

        {/* Flood Prediction Analysis */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">Flood Risk Assessment</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-lg mb-3">📋 Risk Analysis</h3>
              <div className="space-y-2">
                <p><strong>Current Risk Level:</strong> <span className={getStatusColor(stats.latest)}>{alertLevel.toUpperCase()}</span></p>
                <p><strong>Trend Direction:</strong> {getTrendIcon(stats.trend)} {stats.trend.toUpperCase()}</p>
                <p><strong>Predicted Impact:</strong> {predictCloggingRisk()}</p>
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-3">📊 Threshold Guidelines</h3>
              <div className="space-y-1 text-sm">
                <p>🟢 <strong>Normal:</strong> &lt; {thresholds.normal} NTU - Safe levels</p>
                <p>🟡 <strong>Warning:</strong> &gt; {thresholds.warning} NTU - Monitor closely</p>
                <p>🟠 <strong>Danger:</strong> &gt; {thresholds.danger} NTU - Prepare for action</p>
                <p>🔴 <strong>Critical:</strong> &gt; {thresholds.critical} NTU - Immediate response</p>
              </div>
            </div>
          </div>
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
            Update Monitoring Data
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;