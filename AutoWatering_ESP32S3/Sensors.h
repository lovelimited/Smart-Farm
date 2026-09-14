#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>
#include "Config.h"

// ================================================================
//  SENSOR MODULE INTERFACES
// ================================================================

void flowISR();
void initI2C();
void initRTC();
void initSHT30();
void initSoilSensors();
void initFlowSensor();
void readSensors();
void readSoilMoisture();
void readSHT30Data();
void updateRTC();
void updateFlow();

#endif // SENSORS_H
