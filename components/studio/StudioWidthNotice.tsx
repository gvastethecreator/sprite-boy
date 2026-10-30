import { MonitorX } from "lucide-react";
import { STUDIO_MIN_WIDTH } from "./useStudioViewport";

export interface StudioWidthNoticeProps {
    readonly width: number;
}

/** Full-screen notice for windows narrower than the lane shell supports. */
export function StudioWidthNotice({ width }: StudioWidthNoticeProps) {
    return (
        <div
            role="alert"
            data-studio-width-notice
            className="fixed inset-0 z-[200] flex items-center justify-center bg-app p-6 text-center"
        >
            <div className="max-w-sm">
                <MonitorX size={32} strokeWidth={1.5} aria-hidden="true" className="mx-auto text-textMuted" />
                <h1 className="mt-4 text-lg font-semibold text-textMain">
                    Sprite Boy needs a window at least {STUDIO_MIN_WIDTH} px wide
                </h1>
                <p className="mt-2 text-sm text-textMuted">
                    This window is {Math.round(width)} px wide. Make it wider to continue.
                </p>
            </div>
        </div>
    );
}

export default StudioWidthNotice;
