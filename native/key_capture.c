#include <CommonCrypto/CommonKeyDerivation.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>

/* Captures only the database PBKDF2 inputs into an inherited private pipe.
 * It never writes a key to a log, a file, or a network connection. */
static int capture_pbkdf(CCPBKDFAlgorithm algorithm, const char *password,
                        size_t password_len, const uint8_t *salt, size_t salt_len,
                        CCPseudoRandomAlgorithm prf, unsigned rounds,
                        uint8_t *derived, size_t derived_len) {
    int result = CCKeyDerivationPBKDF(algorithm, password, password_len,
                                     salt, salt_len, prf, rounds,
                                     derived, derived_len);
    if (result == 0 && algorithm == kCCPBKDF2 &&
        prf == kCCPRFHmacAlgSHA512 && rounds == 256000 &&
        password_len == 32 && salt_len == 16 && derived_len == 32) {
        const char *value = getenv("GROUPPULSE_PRIVATE_KEY_FD");
        if (value) {
            char *end = NULL;
            long fd = strtol(value, &end, 10);
            if (end && !*end && fd >= 3 && fd < 1024) {
                fcntl((int)fd, F_SETNOSIGPIPE, 1);
                unsigned char record[52];
                memcpy(record, "GPK1", 4);
                memcpy(record + 4, password, 32);
                memcpy(record + 36, salt, 16);
                ssize_t written;
                do { written = write((int)fd, record, sizeof(record)); }
                while (written < 0 && errno == EINTR);
                volatile unsigned char *wipe = record;
                for (size_t i = 0; i < sizeof(record); i++) wipe[i] = 0;
            }
        }
    }
    return result;
}

__attribute__((used)) static const struct {
    const void *replacement;
    const void *original;
} interpose_pbkdf __attribute__((section("__DATA,__interpose"))) = {
    (const void *)&capture_pbkdf, (const void *)&CCKeyDerivationPBKDF
};
