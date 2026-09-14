#ifndef DISPLAY_MENU_H
#define DISPLAY_MENU_H

#include <Arduino.h>
#include "Config.h"

// ================================================================
//  DISPLAY & MENU MODULE INTERFACES
// ================================================================

void initLCD();
void initEncoder();
void handleEncoder();
void pushMenu(MenuState st);
void popMenu();
void adjustScroll(int itemCount, int visibleRows);
void printPadded(const char* str, int width);
void renderListMenu(const char* title, const char** items, int count);
void getDayString(uint8_t days, char* buf, int bufLen);
void renderDashboard();
void renderCurrentMenu();
void handleMenuInput();
void updateLCD();

#endif // DISPLAY_MENU_H
