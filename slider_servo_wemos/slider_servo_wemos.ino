/*
 * Slider Buka-Tutup dengan 2 Servo (Kiri & Kanan)
 * Board: Wemos D1 R1 (ESP8266)
 *
 * Servo kiri & kanan bergerak MIRROR (berlawanan arah)
 * supaya slider membuka/menutup simetris.
 *
 * Kontrol lewat Serial Monitor (baud 115200):
 *   o = buka (open)
 *   c = tutup (close)
 */

#include <Servo.h>

// ---------- KONFIGURASI PIN ----------
// Di Wemos D1 R1, pakai label D5/D6 (GPIO14/GPIO12) — aman & PWM-friendly.
#define PIN_SERVO_KIRI  D5
#define PIN_SERVO_KANAN D6

// ---------- KONFIGURASI SUDUT ----------
// Sesuaikan angka ini sesuai mekanik slider kamu.
const int KIRI_TUTUP  = 0;     // posisi servo kiri saat slider tertutup
const int KIRI_BUKA   = 180;    // posisi servo kiri saat slider terbuka

const int KANAN_TUTUP = 0;   // servo kanan mirror -> kebalikan dari kiri
const int KANAN_BUKA  = 180;

// Kecepatan gerak (ms delay per derajat). Makin besar = makin pelan/halus.
const int STEP_DELAY  = 0;

// ---------- OBJEK SERVO ----------
Servo servoKiri;
Servo servoKanan;

int posKiri  = KIRI_TUTUP;
int posKanan = KANAN_TUTUP;

void setup() {
  Serial.begin(115200);
  delay(200);

  servoKiri.attach(PIN_SERVO_KIRI);
  servoKanan.attach(PIN_SERVO_KANAN);

  // Mulai dari posisi tertutup
  servoKiri.write(posKiri);
  servoKanan.write(posKanan);

  Serial.println();
  Serial.println("=== Slider Servo Wemos D1 R1 ===");
  Serial.println("Ketik: o = buka | c = tutup");
}

// Gerak halus kedua servo secara bersamaan menuju target
void gerak(int targetKiri, int targetKanan) {
  posKiri  = targetKiri;
  posKanan = targetKanan;
  servoKiri.write(posKiri);
  servoKanan.write(posKanan);
  delay(300);   // kasih waktu servo sampai ke posisi fisik
}

void buka() {
  Serial.println("[AKSI] Membuka slider...");
  gerak(KIRI_BUKA, KANAN_BUKA);
  Serial.println("[OK] Slider terbuka.");
}

void tutup() {
  Serial.println("[AKSI] Menutup slider...");
  gerak(KIRI_TUTUP, KANAN_TUTUP);
  Serial.println("[OK] Slider tertutup.");
}

void loop() {
  if (Serial.available() > 0) {
    char cmd = Serial.read();
    if (cmd == 'o' || cmd == 'O') buka();
    else if (cmd == 'c' || cmd == 'C') tutup();
  }
}
