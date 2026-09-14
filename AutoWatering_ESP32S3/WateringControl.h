#ifndef WATERING_CONTROL_H
#define WATERING_CONTROL_H

#include <Arduino.h>
#include "Config.h"

// ================================================================
//  WATERING CONTROL MODULE INTERFACES
// ================================================================

void initRelay();
void startZone(int z, unsigned long durationMs);
void stopZone(int z);
void controlZones();
void checkSchedule();

#endif // WATERING_CONTROL_H
