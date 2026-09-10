package com.juple.app

import android.content.Intent

/**
 * Best-effort initial title from the sharing app's own Intent - never guessed from arbitrary
 * text. Only Intent.EXTRA_SUBJECT and Intent.EXTRA_TITLE are read (both are share-time,
 * app-supplied signals - many browsers set EXTRA_SUBJECT to the page title when sharing a link).
 * Network metadata (og:title, <title>) fetching is out of scope this round.
 */
object ShareIntentTitleExtractor {
  fun extract(intent: Intent, sharedText: String): String? {
    val trimmedSharedText = sharedText.trim()

    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim()
    if (!subject.isNullOrEmpty() && subject != trimmedSharedText) {
      return subject
    }

    val title = intent.getStringExtra(Intent.EXTRA_TITLE)?.trim()
    if (!title.isNullOrEmpty() && title != trimmedSharedText) {
      return title
    }

    return null
  }
}
