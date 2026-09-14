#ifndef BUZZER_ALARM_H
#define BUZZER_ALARM_H

#include <Arduino.h>
#include "Config.h"

// ================================================================
//  BUZZER & ALARM INTERFACES
// ================================================================

void beep(unsigned long durationMs);
void alarmBeep();
void handleBuzzer();
void checkAlarms();
void triggerAlarm(uint8_t type, int zone, const char* msg);

#endif // BUZZER_ALARM_H
