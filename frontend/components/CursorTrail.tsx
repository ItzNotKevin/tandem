"use client";

import { useEffect, useRef } from "react";

class Point {
    x: number;
    y: number;
    lifetime: number;
    startingLifetime: number;
    size: number;

    constructor(x: number, y: number, lifetime: number) {
        this.x = x;
        this.y = y;
        // Chalk texture: wider spread for a thicker stroke
        this.x += (Math.random() - 0.5) * 45;
        this.y += (Math.random() - 0.5) * 45;

        this.startingLifetime = lifetime;
        this.lifetime = lifetime;

        // Chalk grains: larger varying sizes for a thicker texture
        this.size = Math.random() * 5 + 2;
    }
}

export default function CursorTrail() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pointsRef = useRef<Point[]>([]);
    const mouseRef = useRef({ x: -100, y: -100 });
    const isMovingRef = useRef(false);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const handleResize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };

        handleResize();
        window.addEventListener("resize", handleResize);

        const handleMouseMove = (e: MouseEvent) => {
            mouseRef.current = { x: e.clientX, y: e.clientY };
            isMovingRef.current = true;

            // Extremely high density of larger grains for a solid, thick chalk line
            for (let i = 0; i < 60; i++) {
                // Add some points directly on the cursor, some scattered widely
                const scatter = i < 15 ? 10 : 65;
                pointsRef.current.push(new Point(
                    e.clientX + (Math.random() - 0.5) * scatter,
                    e.clientY + (Math.random() - 0.5) * scatter,
                    100 // Longer lifetime so it sits on the "board"
                ));
            }

            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => {
                isMovingRef.current = false;
            }, 50);
        };

        window.addEventListener("mousemove", handleMouseMove);

        let animationFrameId: number;

        const render = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // the Tandem warm text/accent color
            // #A6977F = roughly rgba(166, 151, 127)

            for (let i = 0; i < pointsRef.current.length; i++) {
                const point = pointsRef.current[i];

                // Float upwards slowly like dust
                point.y -= 0.5;
                point.x += (Math.random() - 0.5) * 1;

                point.lifetime--;

                if (point.lifetime <= 0) {
                    pointsRef.current.splice(i, 1);
                    i--;
                    continue;
                }

                const lifePercent = point.lifetime / point.startingLifetime;

                ctx.beginPath();
                // Opaque chalk white transitioning to a faded dusty yellow
                const alpha = lifePercent > 0.5 ? 0.9 : lifePercent * 1.8;
                ctx.fillStyle = `rgba(242, 238, 226, ${alpha})`;

                // Draw tiny irregular rectangles instead of perfect circles for chalk texture
                ctx.rect(point.x, point.y, point.size, point.size * (0.8 + Math.random() * 0.4));
                ctx.fill();
            }

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => {
            window.removeEventListener("resize", handleResize);
            window.removeEventListener("mousemove", handleMouseMove);
            cancelAnimationFrame(animationFrameId);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="pointer-events-none fixed inset-0 z-0 mix-blend-multiply"
        />
    );
}
