import type { Metadata } from "next";
import { StudioWorld } from "@/components/studio-world";
export const metadata: Metadata = { title: "Fieldwork Studio — play a designer", description: "Walk into a 3D design studio. Make a poster, work with characters, review it, print it and hand it to your client." };
export default function PlayPage() { return <StudioWorld />; }
