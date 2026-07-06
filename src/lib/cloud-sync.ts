"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserDataExportPayload } from "@/lib/user-data-package";

export type CloudSnapshot = {
  payload: UserDataExportPayload;
  payloadVersion: number;
  clientUpdatedAt: string;
  updatedAt: string;
};

export type CloudSnapshotMetadata = {
  payloadVersion: number;
  clientUpdatedAt: string;
  updatedAt: string;
};

type SnapshotRow = {
  payload: unknown;
  payload_version: number;
  client_updated_at: string;
  updated_at: string;
};

type SnapshotMetadataRow = {
  payload_version: number;
  client_updated_at: string;
  updated_at: string;
};

export async function loadCloudSnapshot(supabase: SupabaseClient): Promise<CloudSnapshot | null> {
  const { data, error } = await supabase
    .from("user_data_snapshots")
    .select("payload,payload_version,client_updated_at,updated_at")
    .maybeSingle<SnapshotRow>();

  if (error) throw error;
  if (!data) return null;
  return {
    payload: data.payload as UserDataExportPayload,
    payloadVersion: data.payload_version,
    clientUpdatedAt: data.client_updated_at,
    updatedAt: data.updated_at,
  };
}

export async function loadCloudSnapshotMetadata(supabase: SupabaseClient): Promise<CloudSnapshotMetadata | null> {
  const { data, error } = await supabase
    .from("user_data_snapshots")
    .select("payload_version,client_updated_at,updated_at")
    .maybeSingle<SnapshotMetadataRow>();

  if (error) throw error;
  if (!data) return null;
  return {
    payloadVersion: data.payload_version,
    clientUpdatedAt: data.client_updated_at,
    updatedAt: data.updated_at,
  };
}

export async function saveCloudSnapshot(args: {
  supabase: SupabaseClient;
  userId: string;
  payload: UserDataExportPayload;
  clientUpdatedAt: string;
}) {
  const { error } = await args.supabase.from("user_data_snapshots").upsert(
    {
      user_id: args.userId,
      payload_version: args.payload.version,
      payload: args.payload,
      client_updated_at: args.clientUpdatedAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}
