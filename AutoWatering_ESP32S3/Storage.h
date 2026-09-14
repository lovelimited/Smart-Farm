#ifndef STORAGE_H
#define STORAGE_H

#include <Arduino.h>
#include "Config.h"

// ================================================================
//  STORAGE MODULE INTERFACES (NVS & SD CARD)
// ================================================================

void initSD();
void saveSettings();
void loadSettings();
void logToSD(const char* status, int zone);
void periodicLog();

#endif // STORAGE_H
