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

  useEffect(() => {
    fetchTurbidityData();
  }, []);

  const fetchTurbidityData = async () => {
    try {
      const { data, error } = await supabase
        .from('turbidity_readings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching data:', error);
        return;
      }

      if (data && data.length > 0) {
        const formattedData = data.map(item => ({
          time: new Date(item.created_at).toLocaleTimeString(),
          value: item.turbidity_value,
          fullDate: new Date(item.created_at)
        })).reverse();

        const values = data.map(item => item.turbidity_value);
        const latest = values[0];
        const average = values.reduce((sum, val) => sum + val, 0) / values.length;
        const highest = Math.max(...values);

        setTurbidityData(formattedData);
        setStats({ latest, average: Math.round(average), highest });
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatus = (value) => {
    return value < 2000 ? '✅ Safe' : '⚠️ Unsafe';
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
        
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Latest Value Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Latest Turbidity</h2>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-blue-600">{stats.latest} NTU</span>
              <span className={`text-sm font-medium ${
                stats.latest < 2000 ? 'text-green-600' : 'text-red-600'
              }`}>
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
              <span className={`text-sm font-medium ${
                stats.average < 2000 ? 'text-green-600' : 'text-red-600'
              }`}>
                {getStatus(stats.average)}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-2">50 reading average</p>
          </div>

          {/* Highest Value Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Highest Turbidity</h2>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-red-600">{stats.highest} NTU</span>
              <span className={`text-sm font-medium ${
                stats.highest < 2000 ? 'text-green-600' : 'text-red-600'
              }`}>
                {getStatus(stats.highest)}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-2">Peak reading</p>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-6">Turbidity Over Time</h2>
          <div className="h-80">
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
        </div>

        {/* Refresh Button */}
        <div className="mt-6 flex justify-center">
          <button
            onClick={fetchTurbidityData}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors"
          >
            Refresh Data
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;