import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  BarChart, Bar
} from 'recharts';

// UPDATED THRESHOLDS - Match ESP32 calibration (clear water = 2026 NTU)
const thresholds = {
  normal: 2200.0,       // Slightly above clear water baseline
  warning: 2500.0,      // Light sediment
  highRisk: 3000.0,     // Moderate sediment
  clogging: 3500.0,     // Heavy sediment
  flooding: 3800.0      // Extreme sediment
};

// Sediment load calculation constants
const SEDIMENT_CALIBRATION = {
  // Empirical formula coefficients for sediment concentration (mg/L) = a * NTU + b
  // ESP32 Turbidity sketch aligned with dashboard fields and scale
  #include <WiFi.h>
  #include <HTTPClient.h>
  #include <ArduinoJson.h>

  // Wi-Fi credentials (replace with your own)
  const char* ssid = "Suyat_4G";
  const char* password = "suyat2003";

  // Supabase configuration
  const String SUPABASE_URL_READINGS = "https://sxkgbjbjojusedcgkhse.supabase.co/rest/v1/turbidity_readings";
  const String SUPABASE_URL_ALERTS = "https://sxkgbjbjojusedcgkhse.supabase.co/rest/v1/alert_history";
  const String SUPABASE_URL_RISKS = "https://sxkgbjbjojusedcgkhse.supabase.co/rest/v1/risk_assessments";
  const String SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4a2diamJqb2p1c2VkY2draHNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTM5NjYsImV4cCI6MjA3Mzg2OTk2Nn0.aOyOJi3nfw1Bo5E8G-C5qGm_GrVyLrzeebHhB4_oMQ4"; // replace with your key

  // Pins
  const int turbidityPin = 34;
  const int buzzerPin = 25;

  // Calibration constants - aligned with dashboard mapping (0 - 3000 NTU)
  // Dashboard conversion expects raw ADC around 6..2097 -> NTU up to 3000
  const float RAW_CLEAR = 2097.0;
  const float RAW_TURBID = 6.0;
  const float NTU_MAX = 3000.0;

  // Sediment thresholds - aligned with dashboard alert bands (NTU scale)
  const float NTU_MODERATE = 2200.0; // normal -> warning boundary
  const float NTU_HIGH = 3000.0;     // high risk
  const float NTU_EXTREME = 3500.0;  // extreme (above typical NTU_MAX but kept for parity)

  void setup() {
    Serial.begin(115200);
    pinMode(buzzerPin, OUTPUT);
    digitalWrite(buzzerPin, HIGH); // Silent initially (inverted logic)

    WiFi.begin(ssid, password);
    Serial.print("Connecting to Wi-Fi");
    while (WiFi.status() != WL_CONNECTED) {
      delay(500);
      Serial.print(".");
    }
    Serial.println("\nConnected to Wi-Fi!");
  }

  void loop() {
    int raw = analogRead(turbidityPin);
    float voltage = raw * (3.3 / 4095.0);
    float ntu = mapRawToNTU(raw);
    String sedimentLevel = getSedimentLevel(ntu);

    Serial.print("RAW: "); Serial.print(raw);
    Serial.print("\tVoltage: "); Serial.print(voltage, 3);
    Serial.print(" V\tNTU: "); Serial.print(ntu, 1);
    Serial.print("\tSediment: "); Serial.println(sedimentLevel);

    handleBuzzer(ntu); // Pass NTU directly

    if (WiFi.status() == WL_CONNECTED) {
      int reading_id = sendTurbidityReading(raw, voltage, ntu); // numeric fields
      if (reading_id <= 0) {
        Serial.println("Invalid reading_id, skipping alert and risk upload.");
      } else {
        // Alerts for High or Extreme
        if (sedimentLevel == "High" || sedimentLevel == "Extreme") {
          sendAlert(reading_id, sedimentLevel, "Turbidity exceeded safe level!");
        }

        // Risk assessment
        int risk_level;
        String flood_risk, probability, recommended_action;

        if (sedimentLevel == "Clear") {
          risk_level = 1; flood_risk = "Low"; probability = "Low"; recommended_action = "No action needed";
        } else if (sedimentLevel == "Moderate") {
          risk_level = 2; flood_risk = "Moderate"; probability = "Moderate"; recommended_action = "Monitor closely";
        } else if (sedimentLevel == "High") {
          risk_level = 3; flood_risk = "High"; probability = "High"; recommended_action = "Take immediate action";
        } else { // Extreme
          risk_level = 4; flood_risk = "Very High"; probability = "Very High"; recommended_action = "Immediate intervention required";
        }

        sendRiskAssessment(reading_id, risk_level, flood_risk, sedimentLevel, probability, recommended_action, "10s");
      }
    } else {
      Serial.println("Wi-Fi not connected. Skipping upload.");
    }

    delay(10000); // 10-second interval
  }

  // Map raw ADC to NTU (aligned with dashboard conversion)
  float mapRawToNTU(int raw) {
    // Clamp raw to ADC bounds
    if (raw <= RAW_TURBID) return NTU_MAX;
    if (raw >= RAW_CLEAR) return 0.0;

    // Linear mapping: RAW_CLEAR -> 0 NTU, RAW_TURBID -> NTU_MAX
    return ((RAW_CLEAR - raw) * NTU_MAX) / (RAW_CLEAR - RAW_TURBID);
  }

  // Determine sediment level locally
  String getSedimentLevel(float ntu) {
    if (ntu < NTU_MODERATE) return "Clear";
    if (ntu <= NTU_HIGH) return "Moderate";
    if (ntu < NTU_EXTREME) return "High";
    return "Extreme";
  }

  // Handle buzzer based on NTU (inverted logic for wiring)
  void handleBuzzer(float ntu) {
    if (ntu < NTU_MODERATE) {
      digitalWrite(buzzerPin, HIGH); // Silent
    } 
    else if (ntu <= NTU_HIGH) {
      // warning/moderate - single short beep
      pulseBuzzer(150);
    } 
    else if (ntu < NTU_EXTREME) {
      // high - pulsing
      pulseBuzzer(400);
    } 
    else {
      digitalWrite(buzzerPin, LOW); // Continuous for extreme
    }
  }

  void pulseBuzzer(int intervalMs) {
    digitalWrite(buzzerPin, LOW); // Turn buzzer ON
    delay(intervalMs);
    digitalWrite(buzzerPin, HIGH); // Turn buzzer OFF
    delay(intervalMs);
  }

  // Upload turbidity reading (send float NTU to match dashboard)
  int sendTurbidityReading(int raw, float voltage, float ntu) {
    HTTPClient http;
    http.begin(SUPABASE_URL_READINGS);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("apikey", SUPABASE_KEY);
    http.addHeader("Authorization", "Bearer " + SUPABASE_KEY);
    http.addHeader("Prefer", "return=representation");

    StaticJsonDocument<384> doc;
    doc["raw_value"] = raw;
    doc["voltage"] = voltage;
    float ntuRounded = round(ntu * 10.0) / 10.0; // one decimal place
    doc["ntu_value"] = ntuRounded;
    doc["value"] = ntuRounded;

    String payload;
    serializeJson(doc, payload);

    int httpCode = http.POST(payload);
    int reading_id = -1;

    if (httpCode == 201 || httpCode == 200) {
      String resp = http.getString();
      Serial.println("Turbidity reading uploaded successfully:");
      Serial.println(resp);

      StaticJsonDocument<512> resDoc;
      DeserializationError err = deserializeJson(resDoc, resp);
      if (!err && resDoc.is<JsonArray>()) {
        JsonArray arr = resDoc.as<JsonArray>();
        if (arr.size() > 0) {
          reading_id = arr[0]["id"] | -1;
        }
      } else {
        Serial.print("JSON parse error: ");
        Serial.println(err.c_str());
      }
    } else {
      Serial.print("Error sending turbidity: ");
      Serial.println(httpCode);
      Serial.println(http.getString());
    }

    http.end();
    return reading_id;
  }

  // Alerts
  void sendAlert(int reading_id, String level, String message) {
    if (reading_id <= 0) return;

    HTTPClient http;
    http.begin(SUPABASE_URL_ALERTS);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("apikey", SUPABASE_KEY);
    http.addHeader("Authorization", "Bearer " + SUPABASE_KEY);
    http.addHeader("Prefer", "return=representation");

    StaticJsonDocument<256> doc;
    doc["reading_id"] = reading_id;
    doc["alert_level"] = level;
    doc["message"] = message;
    doc["acknowledged"] = false;

    String payload; serializeJson(doc, payload);

    int code = http.POST(payload);
    if (code == 201 || code == 200) Serial.println("Alert sent successfully.");
    else {
      Serial.print("Error sending alert: "); Serial.println(code);
      Serial.println(http.getString());
    }
    http.end();
  }

  // Risk assessment
  void sendRiskAssessment(int reading_id, int risk_level, String flood_risk, String sediment_level, String probability, String action, String sampling_interval) {
    if (reading_id <= 0) return;

    HTTPClient http;
    http.begin(SUPABASE_URL_RISKS);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("apikey", SUPABASE_KEY);
    http.addHeader("Authorization", "Bearer " + SUPABASE_KEY);
    http.addHeader("Prefer", "return=representation");

    StaticJsonDocument<300> doc;
    doc["reading_id"] = reading_id;
    doc["risk_level"] = risk_level;
    doc["flood_risk"] = flood_risk;
    doc["sediment_level"] = sediment_level;
    doc["probability"] = probability;
    doc["recommended_action"] = action;
    doc["sampling_interval"] = sampling_interval;

    String payload; serializeJson(doc, payload);

    int code = http.POST(payload);
    if (code == 201 || code == 200) Serial.println("Risk assessment sent successfully.");
    else {
      Serial.print("Error sending risk assessment: "); Serial.println(code);
      Serial.println(http.getString());
    }
    http.end();
  }
