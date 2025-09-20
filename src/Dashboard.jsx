import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const Dashboard = () => {
  const [turbidityData, setTurbidityData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    latest: 0,
    average: 0,
    highest: 0
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchTurbidityData();
  }, []);

  const fetchTurbidityData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch data from Supabase - CORRECT COLUMN NAMES
      const { data, error: supabaseError } = await supabase
        .from('turbidity_readings')
        .select('value, created_at')  // ← Changed to 'value' not 'turbidity_value'
        .order('created_at', { ascending: false })
        .limit(50);

      if (supabaseError) {
        console.error('Supabase error:', supabaseError);
        setError('Failed to fetch data from database');
        return;
      }

      console.log('Fetched data:', data); // Debug log

      if (data && data.length > 0) {
        // Format data for chart
        const formattedData = data.map(item => ({
          time: new Date(item.created_at).toLocaleTimeString(),
          value: item.value,  // ← Changed to item.value
          fullDate: new Date(item.created_at)
        })).reverse();

        // Calculate statistics
        const values = data.map(item => item.value);  // ← Changed to item.value
        const latest = values[0];
        const average = values.reduce((sum, val) => sum + val, 0) / values.length;
        const highest = Math.max(...values);

        setTurbidityData(formattedData);
        setStats({ 
          latest, 
          average: Math.round(average), 
          highest 
        });
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

  const getStatus = (value) => {
    return value < 2000 ? '✅ Safe' : '⚠️ Unsafe';
  };

  const getStatusColor = (value) => {
    return value < 2000 ? 'text-green-600' : 'text-red-600';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading dashboard data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">Water Quality Dashboard</h1>
        
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            <p className="font-semibold">Error:</p>
            <p>{error}</p>
            <p className="text-sm mt-2">Please check your Supabase connection and table structure.</p>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Latest Value Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Latest Turbidity</h2>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-blue-600">{stats.latest} NTU</span>
              <span className={`text-sm font-medium ${getStatusColor(stats.latest)}`}>
                {getStatus(stats.latest)}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-2">Most recent reading</p>
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
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Highest Turbidity</h2>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-red-600">{stats.highest} NTU</span>
              <span className={`text-sm font-medium ${getStatusColor(stats.highest)}`}>
                {getStatus(stats.highest)}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-2">Peak reading</p>
          </div>
        </div>

        {/* Chart Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-6">Turbidity Over Time</h2>
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
                <p className="text-sm">Data will appear here when readings are added to Supabase</p>
              </div>
            </div>
          )}
        </div>

        {/* Database Info Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">Database Connection</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-green-100 border border-green-300 p-4 rounded-lg">
              <h3 className="font-semibold">Supabase Status</h3>
              <p className="text-green-700">✅ Connected to turbidity_readings table</p>
              <p className="text-sm text-green-600 mt-1">{turbidityData.length} records loaded</p>
            </div>
            <div className="bg-blue-100 border border-blue-300 p-4 rounded-lg">
              <h3 className="font-semibold">Data Loaded</h3>
              <p className="text-blue-700">Using column: value (turbidity values)</p>
              <p className="text-sm text-blue-600 mt-1">Latest value: {stats.latest} NTU</p>
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
            Refresh Data
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;