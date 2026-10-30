import textToSpeech from "@google-cloud/text-to-speech";
import { NextResponse } from "next/server";

import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";
import {
  languageToBcp47,
  validateTtsRequestBody,
  writeNewNotificationMp3,
} from "@/lib/admin-tts";

/**
 * Admin TTS generation.
 * Permission: announcements.manage (narrowest existing key tied to announcement
 * TTS fields / future announcement audio). Super Admin bypasses via RBAC helper.
 * Continues writing under public/notifications so returned URLs stay compatible
 * with historical /notifications/{file}.mp3 playback. Never overwrites existing files.
 */
export async function POST(request: Request) {
  const gate = await requireAdminPermission("announcements.manage", {
    request,
    auditModule: "tts",
  });
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const validated = validateTtsRequestBody(body);
  if (!validated.ok) {
    return NextResponse.json(
      { ok: false, success: false, error: validated.error },
      { status: 400 },
    );
  }

  try {
    const client = new textToSpeech.TextToSpeechClient({
      keyFilename: "./google-tts.json",
    });

    const [response] = await client.synthesizeSpeech({
      input: { text: validated.text },
      voice: {
        languageCode: languageToBcp47(validated.language),
        ssmlGender: "FEMALE",
      },
      audioConfig: {
        audioEncoding: "MP3",
      },
    });

    if (!response.audioContent) {
      return NextResponse.json(
        { ok: false, success: false, error: "No audio generated." },
        { status: 502 },
      );
    }

    const audioBuffer = Buffer.from(response.audioContent as Uint8Array);
    const written = writeNewNotificationMp3(audioBuffer);
    if (!written.ok) {
      const status = written.code === "EEXIST" ? 409 : 500;
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error: written.error || "Unable to store audio.",
        },
        { status },
      );
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const url = appUrl
      ? `${appUrl}${written.publicUrlPath}`
      : written.publicUrlPath;

    return NextResponse.json({
      ok: true,
      success: true,
      url,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: safeErrorMessage(error, "Unable to generate speech."),
      },
      { status: 500 },
    );
  }
}
