"use client";

import { useEffect, useRef } from "react";
import type { Product } from "@/types/menu";
import { Icon } from "@/components/ui/icon";
import { ProductDetails } from "./product-details";

export function ProductModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      trigger?.focus({ preventScroll: true });
    };
  }, []);

  return <dialog
    ref={dialogRef}
    className="product-modal"
    aria-labelledby="product-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}
  >
    <div className="product-modal-header">
      <span>Detalhes do produto</span>
      <button type="button" onClick={onClose} aria-label="Fechar detalhes do produto"><Icon name="close" /></button>
    </div>
    <ProductDetails product={product} heading="h2" />
  </dialog>;
}
