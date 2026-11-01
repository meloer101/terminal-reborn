/*
 * The few libsodium utilities the vendored ristretto255 files call (sodium/utils.c and randombytes, libsodium 1.0.20,
 * ISC, LICENSE-libsodium), with the portable code paths only; randomness from the system's arc4random_buf.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "randombytes.h"
#include "utils.h"

void
randombytes_buf(void * const buf, const size_t size)
{
    arc4random_buf(buf, size);
}

void
sodium_memzero(void * const pnt, const size_t len)
{
    memset_s(pnt, len, 0, len);
}

int
sodium_is_zero(const unsigned char *n, const size_t nlen)
{
    size_t                 i;
    volatile unsigned char d = 0U;

    for (i = 0U; i < nlen; i++) {
        d |= n[i];
    }
    return 1 & ((d - 1) >> 8);
}

void
sodium_add(unsigned char *a, const unsigned char *b, const size_t len)
{
    size_t        i;
    uint_fast16_t c = 0U;

    for (i = 0U; i < len; i++) {
        c += (uint_fast16_t) a[i] + (uint_fast16_t) b[i];
        a[i] = (unsigned char) c;
        c >>= 8;
    }
}

void
sodium_sub(unsigned char *a, const unsigned char *b, const size_t len)
{
    uint_fast16_t c = 0U;
    size_t        i;

    for (i = 0U; i < len; i++) {
        c = (uint_fast16_t) a[i] - (uint_fast16_t) b[i] - c;
        a[i] = (unsigned char) c;
        c = (c >> 8) & 1U;
    }
}
