import type { Category, Product } from "@/types/menu";

export const categories: readonly Category[] = [
  {
    "id": "salgados-assados",
    "name": "Salgados assados"
  },
  {
    "id": "salgados-fritos",
    "name": "Salgados fritos"
  },
  {
    "id": "sucos",
    "name": "Sucos"
  },
  {
    "id": "vitaminas",
    "name": "Vitaminas"
  },
  {
    "id": "refrigerantes",
    "name": "Refrigerantes"
  }
];

export const products: readonly Product[] = [
  {
    "id": "esfirra-carne",
    "name": "Esfirra de carne",
    "description": "Massa de trigo assada, recheada com carne e molho de maionese e ketchup.",
    "priceInCents": 400,
    "categoryId": "salgados-assados",
    "dough": "trigo",
    "image": {
      "src": "/images/produtos/esfirra-carne.png",
      "alt": "Esfirra de carne"
    }
  },
  {
    "id": "esfirra-frango",
    "name": "Esfirra de frango",
    "description": "Massa de trigo assada, recheada com frango e molho de maionese e ketchup.",
    "priceInCents": 400,
    "categoryId": "salgados-assados",
    "dough": "trigo",
    "image": {
      "src": "/images/produtos/esfirra-frango.png",
      "alt": "Esfirra de frango"
    }
  },
  {
    "id": "esfirra-presunto-queijo",
    "name": "Esfirra de presunto e queijo",
    "description": "Massa de trigo assada, recheada com presunto, queijo e molho de maionese e ketchup.",
    "priceInCents": 400,
    "categoryId": "salgados-assados",
    "dough": "trigo",
    "image": {
      "src": "/images/produtos/esfirra-presunto-queijo.png",
      "alt": "Esfirra de presunto e queijo"
    }
  },
  {
    "id": "enroladinho-salsicha",
    "name": "Enroladinho de salsicha",
    "description": "Massa de trigo assada, recheada com salsicha e molho de maionese e ketchup.",
    "priceInCents": 400,
    "categoryId": "salgados-assados",
    "dough": "trigo",
    "image": {
      "src": "/images/produtos/enroladinho-salsicha.png",
      "alt": "Enroladinho de salsicha"
    }
  },
  {
    "id": "bolinho-piracui",
    "name": "Bolinho de piracuí",
    "description": "Preparado com massa de macaxeira.",
    "priceInCents": 400,
    "categoryId": "salgados-fritos",
    "dough": "macaxeira",
    "image": {
      "src": "/images/produtos/bolinho-piracui.jpg",
      "alt": "Bolinho de piracuí"
    }
  },
  {
    "id": "coxinha-frango",
    "name": "Coxinha de frango",
    "description": "Preparado com massa de macaxeira.",
    "priceInCents": 400,
    "categoryId": "salgados-fritos",
    "dough": "macaxeira",
    "image": {
      "src": "/images/produtos/coxinha-frango.png",
      "alt": "Coxinha de frango"
    }
  },
  {
    "id": "croquete-carne",
    "name": "Croquete de carne",
    "description": "Preparado com massa de macaxeira.",
    "priceInCents": 400,
    "categoryId": "salgados-fritos",
    "dough": "macaxeira",
    "image": {
      "src": "/images/produtos/croquete-carne.png",
      "alt": "Croquete de carne"
    }
  },
  {
    "id": "ovo-coberto",
    "name": "Ovo coberto",
    "description": "Preparado com massa de macaxeira.",
    "priceInCents": 400,
    "categoryId": "salgados-fritos",
    "dough": "macaxeira",
    "image": {
      "src": "/images/produtos/ovo-coberto.png",
      "alt": "Ovo coberto"
    }
  },
  {
    "id": "risole-presunto-queijo",
    "name": "Risole de presunto e queijo",
    "description": "Massa de trigo frita, recheada com presunto, queijo e molho de maionese e ketchup.",
    "priceInCents": 400,
    "categoryId": "salgados-fritos",
    "dough": "trigo",
    "image": {
      "src": "/images/produtos/risole-queijo-presunto.png",
      "alt": "Risole de presunto e queijo"
    }
  },
  {
    "id": "risole-camarao",
    "name": "Risole de camarão",
    "description": "Massa de trigo frita e recheada com camarão.",
    "priceInCents": 400,
    "categoryId": "salgados-fritos",
    "dough": "trigo",
    "image": {
      "src": "/images/produtos/risole-camarao.png",
      "alt": "Risole de camarão"
    }
  },
  {
    "id": "risole-carne",
    "name": "Risole de carne",
    "description": "Massa de trigo frita, recheada com carne e molho de maionese e ketchup.",
    "priceInCents": 400,
    "categoryId": "salgados-fritos",
    "dough": "trigo",
    "image": {
      "src": "/images/produtos/risole-carne.png",
      "alt": "Risole de carne"
    }
  },
  {
    "id": "risole-frango",
    "name": "Risole de frango",
    "description": "Massa de trigo frita, recheada com frango e molho de maionese e ketchup.",
    "priceInCents": 400,
    "categoryId": "salgados-fritos",
    "dough": "trigo",
    "image": {
      "src": "/images/produtos/risole-frango.png",
      "alt": "Risole de frango"
    }
  },
  {
    "id": "suco-maracuja",
    "name": "Suco de maracujá",
    "description": "Copo de 250 ml.",
    "priceInCents": 400,
    "categoryId": "sucos",
    "image": {
      "src": "/images/produtos/suco-maracuja.png",
      "alt": "Suco de maracujá"
    }
  },
  {
    "id": "suco-acerola",
    "name": "Suco de acerola",
    "description": "Copo de 250 ml.",
    "priceInCents": 400,
    "categoryId": "sucos",
    "image": {
      "src": "/images/produtos/suco-acerola.png",
      "alt": "Suco de acerola"
    }
  },
  {
    "id": "suco-cupuacu",
    "name": "Suco de cupuaçu",
    "description": "Copo de 250 ml.",
    "priceInCents": 400,
    "categoryId": "sucos",
    "image": {
      "src": "/images/produtos/suco-cupu.png",
      "alt": "Suco de cupuaçu"
    }
  },
  {
    "id": "suco-goiaba",
    "name": "Suco de goiaba",
    "description": "Copo de 250 ml.",
    "priceInCents": 400,
    "categoryId": "sucos",
    "image": {
      "src": "/images/produtos/suco-goiaba.png",
      "alt": "Suco de goiaba"
    }
  },
  {
    "id": "suco-tapereba",
    "name": "Suco de taperebá",
    "description": "Copo de 250 ml.",
    "priceInCents": 400,
    "categoryId": "sucos",
    "image": {
      "src": "/images/produtos/suco_tapereba.png",
      "alt": "Suco de taperebá"
    }
  },
  {
    "id": "suco-graviola",
    "name": "Suco de graviola",
    "description": "Copo de 250 ml.",
    "priceInCents": 400,
    "categoryId": "sucos",
    "image": {
      "src": "/images/produtos/suco-graviola.png",
      "alt": "Suco de graviola"
    }
  },
  {
    "id": "vitamina-abacate",
    "name": "Vitamina de abacate",
    "description": "Copo de 250 ml.",
    "priceInCents": 600,
    "categoryId": "vitaminas",
    "image": {
      "src": "/images/produtos/vitamina-abacate.png",
      "alt": "Vitamina de abacate"
    }
  },
  {
    "id": "bare-1l",
    "name": "Baré 1 L",
    "description": "Garrafa de 1 L.",
    "priceInCents": 600,
    "categoryId": "refrigerantes",
    "image": {
      "src": "/images/produtos/bare-1l.png",
      "alt": "Baré 1 L"
    }
  },
  {
    "id": "coca-lata",
    "name": "Coca-Cola",
    "description": "Lata.",
    "priceInCents": 500,
    "categoryId": "refrigerantes",
    "image": {
      "src": "/images/produtos/coca-lata.png",
      "alt": "Coca-Cola"
    }
  },
  {
    "id": "coca-zero-lata",
    "name": "Coca-Cola Zero",
    "description": "Lata.",
    "priceInCents": 500,
    "categoryId": "refrigerantes",
    "image": {
      "src": "/images/produtos/coca-zero-lata.png",
      "alt": "Coca-Cola Zero"
    }
  },
  {
    "id": "fanta-uva-lata",
    "name": "Fanta Uva",
    "description": "Lata.",
    "priceInCents": 500,
    "categoryId": "refrigerantes",
    "image": {
      "src": "/images/produtos/fanta-uva-lata.png",
      "alt": "Fanta Uva"
    }
  },
  {
    "id": "fanta-laranja-lata",
    "name": "Fanta Laranja",
    "description": "Lata.",
    "priceInCents": 500,
    "categoryId": "refrigerantes",
    "image": {
      "src": "/images/produtos/fanta-laranja-lata.png",
      "alt": "Fanta Laranja"
    }
  },
  {
    "id": "bare-lata",
    "name": "Baré",
    "description": "Lata.",
    "priceInCents": 500,
    "categoryId": "refrigerantes",
    "image": {
      "src": "/images/produtos/bare-lata.png",
      "alt": "Baré"
    }
  },
  {
    "id": "pepsi-lata",
    "name": "Pepsi",
    "description": "Lata.",
    "priceInCents": 500,
    "categoryId": "refrigerantes",
    "image": {
      "src": "/images/produtos/pepsi-lata.png",
      "alt": "Pepsi"
    }
  }
];

