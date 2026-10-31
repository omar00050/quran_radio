'use strict';

/**
 * Validated OGG page parsing (contract §I9).
 *
 * The previous implementation (`AudioBroadcaster._findOggHeaderEnd`) just did
 * `buf.indexOf('OggS')` and assumed the 3rd hit was the end of the header.
 * Those four bytes can legitimately occur inside an Opus payload, which would
 * truncate the cached header and break every late joiner that replays it.
 *
 * This module parses real OGG page structure (RFC 3533) and identifies the
 * header pages by their payload magic (`OpusHead` / `OpusTags`, RFC 7845)
 * instead of counting magic-byte occurrences.
 */

const OGGS_MAGIC = Buffer.from('OggS');

/**
 * Parses a single OGG page starting at `offset`.
 * @returns {null|{invalid:true}|{invalid:false,offset:number,length:number,
 *           headerType:number,payloadStart:number,payloadLength:number}}
 *          `null` means "not enough data yet, try again once more bytes arrive".
 */
function parsePageAt(buf, offset) {
  // Fixed page header is 27 bytes (magic[4] + version[1] + header_type[1] +
  // granule_position[8] + serial[4] + sequence[4] + crc[4] + page_segments[1]).
  if (offset < 0 || offset + 27 > buf.length) return null;
  if (buf.indexOf(OGGS_MAGIC, offset) !== offset) return { invalid: true };

  const version = buf[offset + 4];
  if (version !== 0) return { invalid: true };

  const headerType = buf[offset + 5];
  const pageSegments = buf[offset + 26];
  const segTableStart = offset + 27;
  const segTableEnd = segTableStart + pageSegments;
  if (segTableEnd > buf.length) return null;

  let payloadLength = 0;
  for (let i = segTableStart; i < segTableEnd; i++) payloadLength += buf[i];

  const payloadStart = segTableEnd;
  const length = 27 + pageSegments + payloadLength;
  if (offset + length > buf.length) return null;

  return { invalid: false, offset, length, headerType, payloadStart, payloadLength };
}

/**
 * Parses as many complete OGG pages as possible from the start of `buf`.
 * @returns {{pages: Array<{start:number,length:number,headerType:number,
 *           buffer:Buffer,payload:Buffer}>, consumed:number}}
 */
function parsePages(buf) {
  const pages = [];
  let offset = 0;
  while (offset < buf.length) {
    const page = parsePageAt(buf, offset);
    if (!page || page.invalid) break;
    pages.push({
      start: page.offset,
      length: page.length,
      headerType: page.headerType,
      buffer: buf.slice(page.offset, page.offset + page.length),
      payload: buf.slice(page.payloadStart, page.payloadStart + page.payloadLength),
    });
    offset += page.length;
  }
  return { pages, consumed: offset };
}

function isOpusHead(payload) {
  return payload.length >= 8 && payload.slice(0, 8).toString('latin1') === 'OpusHead';
}

function isOpusTags(payload) {
  return payload.length >= 8 && payload.slice(0, 8).toString('latin1') === 'OpusTags';
}

/**
 * Determines whether the OGG Opus header (OpusHead page, followed by the
 * OpusTags/comment page) is fully present at the start of `buf`, identifying
 * the pages by payload content rather than by counting `OggS` occurrences.
 *
 * @returns {number} byte offset where the header ends (first audio page
 *          starts), or -1 if more data is needed (or the stream doesn't
 *          look like a valid Opus stream at all).
 */
function findOggHeaderEnd(buf) {
  const { pages } = parsePages(buf);
  if (pages.length === 0) return -1;

  let sawHead = false;
  let sawTags = false;
  let headerEnd = -1;

  for (const page of pages) {
    if (!sawHead) {
      if (!isOpusHead(page.payload)) return -1; // not an Opus stream (yet, or ever)
      sawHead = true;
      headerEnd = page.start + page.length;
      continue;
    }
    if (!sawTags) {
      if (isOpusTags(page.payload)) {
        sawTags = true;
        headerEnd = page.start + page.length;
        continue;
      }
      // No distinct OpusTags page observed — header is just OpusHead.
      return headerEnd;
    }
    // Both header pages seen; this page is the first audio page.
    return headerEnd;
  }

  // Ran out of parsed (complete) pages before reaching an audio page.
  return -1;
}

module.exports = { parsePageAt, parsePages, isOpusHead, isOpusTags, findOggHeaderEnd };
