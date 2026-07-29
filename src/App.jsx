import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import "./App.css";

function App() {
  const [session, setSession] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const [tables, setTables] = useState([]);
  const [selectedOrderType, setSelectedOrderType] = useState(null);

  const [menuItems, setMenuItems] = useState([]);

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Alle");

  const [cart, setCart] = useState([]);

  const [sendingOrder, setSendingOrder] = useState(false);
  const [orderMessage, setOrderMessage] = useState("");

  const [view, setView] = useState("orders");

  const [kitchenOrders, setKitchenOrders] = useState([]);
  const [loadingKitchen, setLoadingKitchen] = useState(false);

  const [selectedMenuItem, setSelectedMenuItem] = useState(null);
  const [modalQuantity, setModalQuantity] = useState(1);
  const [modalNote, setModalNote] = useState("");

  const kitchenInitializedRef = useRef(false);
  const audioContextRef = useRef(null);

  /* =========================
     AUDIO
  ========================= */

  function getAudioContext() {
    try {
      const AudioContext =
          window.AudioContext || window.webkitAudioContext;

      if (!AudioContext) return null;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      return audioContextRef.current;
    } catch (error) {
      console.error("AudioContext Fehler:", error);
      return null;
    }
  }

  async function unlockKitchenSound() {
    try {
      const audioContext = getAudioContext();

      if (!audioContext) return;

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
    } catch (error) {
      console.error(
          "Audio konnte nicht aktiviert werden:",
          error
      );
    }
  }

  async function playKitchenSound() {
    try {
      const audioContext = getAudioContext();

      if (!audioContext) return;

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const now = audioContext.currentTime;

      function createBeep(startTime, frequency) {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = "sine";

        oscillator.frequency.setValueAtTime(
            frequency,
            startTime
        );

        gainNode.gain.setValueAtTime(
            0.0001,
            startTime
        );

        gainNode.gain.exponentialRampToValueAtTime(
            0.8,
            startTime + 0.02
        );

        gainNode.gain.exponentialRampToValueAtTime(
            0.0001,
            startTime + 0.8
        );

        oscillator.start(startTime);
        oscillator.stop(startTime + 0.4);
      }

      createBeep(now, 880);
      createBeep(now + 0.45, 1100);
    } catch (error) {
      console.error(
          "Ton konnte nicht abgespielt werden:",
          error
      );
    }
  }

  /* =========================
     SESSION
  ========================= */

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
        (_event, newSession) => {
          setSession(newSession);
        }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    loadTables();
    loadMenu();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    if (tables.length === 0 || menuItems.length === 0) return;

    loadKitchenOrders();
  }, [session, tables, menuItems]);

  useEffect(() => {
    if (!session) return;

    const unlock = () => {
      unlockKitchenSound();

      window.removeEventListener(
          "pointerdown",
          unlock
      );

      window.removeEventListener(
          "keydown",
          unlock
      );
    };

    window.addEventListener(
        "pointerdown",
        unlock
    );

    window.addEventListener(
        "keydown",
        unlock
    );

    return () => {
      window.removeEventListener(
          "pointerdown",
          unlock
      );

      window.removeEventListener(
          "keydown",
          unlock
      );
    };
  }, [session]);

  /* =========================
     REALTIME
  ========================= */

  useEffect(() => {
    if (!session) return;

    const channel = supabase
        .channel("kitchen-realtime")
        .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "orders",
            },
            () => {
              loadKitchenOrders();
            }
        )
        .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "order_items",
            },
            () => {
              loadKitchenOrders();
            }
        )
        .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, tables, menuItems]);

  /* =========================
     LOGIN
  ========================= */

  async function login(e) {
    e.preventDefault();

    setMessage("");

    const { error } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });

    if (error) {
      setMessage(
          "Login fehlgeschlagen: " + error.message
      );
    }
  }

  async function logout() {
    await supabase.auth.signOut();

    kitchenInitializedRef.current = false;

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch (error) {
        console.error(error);
      }

      audioContextRef.current = null;
    }

    setTables([]);
    setMenuItems([]);
    setSelectedOrderType(null);
    setCart([]);
    setSearch("");
    setSelectedCategory("Alle");
    setOrderMessage("");
    setKitchenOrders([]);
    setView("orders");
  }

  /* =========================
     DATEN LADEN
  ========================= */

  async function loadTables() {
    const { data, error } = await supabase
        .from("restaurant_tables")
        .select("*");

    if (error) {
      console.error(error);

      setMessage(
          "Bestellarten konnten nicht geladen werden."
      );

      return;
    }

    setTables(data ?? []);
  }

  async function loadMenu() {
    const { data, error } = await supabase
        .from("menu_items")
        .select("*")
        .eq("active", true);

    if (error) {
      console.error(error);

      setMessage(
          "Speisekarte konnte nicht geladen werden."
      );

      return;
    }

    setMenuItems(data ?? []);
  }

  async function loadKitchenOrders() {
    if (!session) return;

    setLoadingKitchen(true);

    try {
      const {
        data: ordersData,
        error: ordersError,
      } = await supabase
          .from("orders")
          .select("*")
          .neq("status", "done")
          .order("created_at", {
            ascending: true,
          });

      if (ordersError) {
        throw ordersError;
      }

      const orders = ordersData ?? [];

      if (orders.length === 0) {
        setKitchenOrders([]);
        kitchenInitializedRef.current = true;
        return;
      }

      const orderIds = orders.map(
          (order) => order.id
      );

      const {
        data: itemsData,
        error: itemsError,
      } = await supabase
          .from("order_items")
          .select("*")
          .in("order_id", orderIds)
          .order("created_at", {
            ascending: true,
          });

      if (itemsError) {
        throw itemsError;
      }

      const items = itemsData ?? [];

      const mergedOrders = orders.map(
          (order) => {
            const table = tables.find(
                (table) =>
                    table.id === order.table_id
            );

            const orderItems = items
                .filter(
                    (item) =>
                        item.order_id === order.id
                )
                .map((item) => {
                  const menuItem = menuItems.find(
                      (menuItem) =>
                          menuItem.id ===
                          item.menu_item_id
                  );

                  return {
                    ...item,
                    menuItem,
                  };
                });

            return {
              ...order,
              table,
              items: orderItems,
            };
          }
      );

      setKitchenOrders((currentOrders) => {
        const previousOrderIds = new Set(
            currentOrders.map(
                (order) => order.id
            )
        );

        const hasNewOrder =
            mergedOrders.some(
                (order) =>
                    !previousOrderIds.has(
                        order.id
                    )
            );

        if (
            kitchenInitializedRef.current &&
            hasNewOrder
        ) {
          playKitchenSound();
        }

        kitchenInitializedRef.current =
            true;

        return mergedOrders;
      });
    } catch (error) {
      console.error(
          "Küchenbestellungen konnten nicht geladen werden:",
          error
      );
    } finally {
      setLoadingKitchen(false);
    }
  }

  /* =========================
     BESTELLARTEN
  ========================= */

  const dineInTable = useMemo(() => {
    return tables.find(
        (table) => table.type === "table"
    );
  }, [tables]);

  const takeawayTable = useMemo(() => {
    return tables.find(
        (table) => table.type === "takeaway"
    );
  }, [tables]);

  function chooseOrderType(type) {
    if (type === "dinein") {
      if (!dineInTable) {
        setMessage(
            'Kein Eintrag mit type "table" gefunden.'
        );

        return;
      }

      setSelectedOrderType({
        type: "dinein",
        label: "Hier essen",
        icon: "🍽️",
        table: dineInTable,
      });
    }

    if (type === "takeaway") {
      if (!takeawayTable) {
        setMessage(
            'Kein Eintrag mit type "takeaway" gefunden.'
        );

        return;
      }

      setSelectedOrderType({
        type: "takeaway",
        label: "Mitnehmen",
        icon: "🥡",
        table: takeawayTable,
      });
    }

    setCart([]);
    setSearch("");
    setSelectedCategory("Alle");
    setOrderMessage("");
    setMessage("");
  }

  /* =========================
     SORTIERUNG
  ========================= */

  function naturalItemSort(a, b) {
    const parse = (value) => {
      const match = String(
          value ?? ""
      ).match(/^(\d+)(.*)$/);

      if (!match) {
        return {
          number: 999999,
          suffix: String(
              value ?? ""
          ).toLowerCase(),
        };
      }

      return {
        number: Number(match[1]),
        suffix: match[2].toLowerCase(),
      };
    };

    const first = parse(a.item_number);
    const second = parse(b.item_number);

    if (
        first.number !== second.number
    ) {
      return (
          first.number - second.number
      );
    }

    return first.suffix.localeCompare(
        second.suffix
    );
  }

  const categories = useMemo(() => {
    const uniqueCategories = [
      ...new Set(
          menuItems
              .map((item) => item.category)
              .filter(Boolean)
      ),
    ];

    return [
      "Alle",
      ...uniqueCategories,
    ];
  }, [menuItems]);

  const filteredItems = useMemo(() => {
    const searchText =
        search.trim().toLowerCase();

    return [...menuItems]
        .filter((item) => {
          const categoryMatches =
              selectedCategory === "Alle" ||
              item.category ===
              selectedCategory;

          const numberMatches = String(
              item.item_number ?? ""
          )
              .toLowerCase()
              .includes(searchText);

          const nameMatches = String(
              item.name ?? ""
          )
              .toLowerCase()
              .includes(searchText);

          const searchMatches =
              searchText === "" ||
              numberMatches ||
              nameMatches;

          return (
              categoryMatches &&
              searchMatches
          );
        })
        .sort(naturalItemSort);
  }, [
    menuItems,
    search,
    selectedCategory,
  ]);

  /* =========================
     GERICHT POPUP
  ========================= */

  function openItemModal(item) {
    setSelectedMenuItem(item);
    setModalQuantity(1);
    setModalNote("");
  }

  function closeItemModal() {
    setSelectedMenuItem(null);
    setModalQuantity(1);
    setModalNote("");
  }

  function addConfiguredItemToCart() {
    if (!selectedMenuItem) return;

    const cartItem = {
      ...selectedMenuItem,

      cartId:
          `${selectedMenuItem.id}-` +
          `${Date.now()}-` +
          `${Math.random()}`,

      quantity: modalQuantity,
      note: modalNote.trim(),
    };

    setCart((currentCart) => [
      ...currentCart,
      cartItem,
    ]);

    closeItemModal();
  }

  /* =========================
     WARENKORB
  ========================= */

  function increaseQuantity(cartId) {
    setCart((currentCart) =>
        currentCart.map((item) =>
            item.cartId === cartId
                ? {
                  ...item,
                  quantity:
                      item.quantity + 1,
                }
                : item
        )
    );
  }

  function decreaseQuantity(cartId) {
    setCart((currentCart) =>
        currentCart
            .map((item) =>
                item.cartId === cartId
                    ? {
                      ...item,
                      quantity:
                          item.quantity - 1,
                    }
                    : item
            )
            .filter(
                (item) =>
                    item.quantity > 0
            )
    );
  }

  const cartQuantity =
      cart.reduce(
          (sum, item) =>
              sum + item.quantity,
          0
      );

  const cartTotal =
      cart.reduce(
          (sum, item) =>
              sum +
              Number(item.price || 0) *
              item.quantity,
          0
      );

  /* =========================
     BESTELLUNG SENDEN
  ========================= */

  async function sendOrder() {
    if (
        !selectedOrderType ||
        cart.length === 0
    ) {
      return;
    }

    setSendingOrder(true);
    setOrderMessage("");

    try {
      const {
        data: order,
        error: orderError,
      } = await supabase
          .from("orders")
          .insert({
            table_id:
            selectedOrderType.table.id,

            status: "open",
          })
          .select()
          .single();

      if (orderError) {
        throw orderError;
      }

      const orderItems = cart.map(
          (item) => ({
            order_id: order.id,
            menu_item_id: item.id,
            quantity: item.quantity,
            note: item.note || null,
            status: "new",
          })
      );

      const { error: itemsError } =
          await supabase
              .from("order_items")
              .insert(orderItems);

      if (itemsError) {
        throw itemsError;
      }

      setCart([]);

      setOrderMessage(
          "✓ Bestellung wurde erfolgreich gesendet."
      );

      await loadKitchenOrders();

      setTimeout(() => {
        setSelectedOrderType(null);
        setSearch("");
        setSelectedCategory("Alle");
        setOrderMessage("");
        setView("orders");
      }, 1200);
    } catch (error) {
      console.error(error);

      setOrderMessage(
          "Bestellung konnte nicht gesendet werden: " +
          (error?.message ??
              "Unbekannter Fehler")
      );
    } finally {
      setSendingOrder(false);
    }
  }

  /* =========================
     FERTIG
  ========================= */

  async function markDone(orderId) {
    const previousOrders =
        kitchenOrders;

    setKitchenOrders(
        (currentOrders) =>
            currentOrders.filter(
                (order) =>
                    order.id !== orderId
            )
    );

    try {
      const {
        error: orderError,
      } = await supabase
          .from("orders")
          .update({
            status: "done",
          })
          .eq("id", orderId);

      if (orderError) {
        throw orderError;
      }

      const {
        error: itemsError,
      } = await supabase
          .from("order_items")
          .update({
            status: "done",
          })
          .eq("order_id", orderId);

      if (itemsError) {
        console.error(itemsError);
      }
    } catch (error) {
      console.error(error);

      setKitchenOrders(
          previousOrders
      );
    }
  }

  /* =========================
     LOGIN
  ========================= */

  if (!session) {
    return (
        <div className="login-page">
          <form
              className="login-card"
              onSubmit={login}
          >
            <h1>Little Asia</h1>

            <p className="subtitle">
              Mitarbeiter Login
            </p>

            <input
                type="email"
                placeholder="E-Mail"
                value={email}
                onChange={(e) =>
                    setEmail(
                        e.target.value
                    )
                }
                required
            />

            <input
                type="password"
                placeholder="Passwort"
                value={password}
                onChange={(e) =>
                    setPassword(
                        e.target.value
                    )
                }
                required
            />

            <button
                type="submit"
                className="primary-button"
            >
              Einloggen
            </button>

            {message && (
                <p className="message">
                  {message}
                </p>
            )}
          </form>
        </div>
    );
  }

  /* =========================
     KÜCHE
  ========================= */

  if (view === "kitchen") {
    return (
        <div className="app">
          <header className="topbar">
            <div>
              <h1>Little Asia</h1>
              <p>Küchenmonitor</p>
            </div>

            <div
                style={{
                  display: "flex",
                  gap: "10px",
                }}
            >
              <button
                  className="back-button"
                  onClick={() =>
                      setView("orders")
                  }
              >
                ← Bestellungen
              </button>

              <button
                  className="logout-button"
                  onClick={logout}
              >
                Abmelden
              </button>
            </div>
          </header>

          <main className="content">
            <div className="section-title">
              <h2>
                Offene Bestellungen
              </h2>

              <span>
              {kitchenOrders.length}{" "}
                {kitchenOrders.length === 1
                    ? "Bestellung"
                    : "Bestellungen"}
            </span>
            </div>

            {loadingKitchen &&
            kitchenOrders.length === 0 ? (
                <p>
                  Lade Bestellungen...
                </p>
            ) : kitchenOrders.length === 0 ? (
                <div className="kitchen-empty">
                  <div>✅</div>

                  <h3>
                    Keine offenen Bestellungen
                  </h3>

                  <p>
                    Neue Bestellungen erscheinen
                    automatisch.
                  </p>
                </div>
            ) : (
                <div className="kitchen-grid">
                  {kitchenOrders.map(
                      (order) => (
                          <div
                              key={order.id}
                              className="kitchen-order-card"
                          >
                            <div className="kitchen-order-header">
                              <div>
                                <h3>
                                  {order.table
                                      ?.type ===
                                  "takeaway"
                                      ? "🥡 MANG VỀ"
                                      : "🍽️ ĂN Ở ĐÂY"}
                                </h3>

                                <span>
                          Bestellung #
                                  {order.id}
                        </span>
                              </div>
                            </div>

                            <div className="kitchen-order-items">
                              {order.items
                                  ?.length > 0 ? (
                                  order.items.map(
                                      (item) => (
                                          <div
                                              className="kitchen-order-item"
                                              key={
                                                item.id
                                              }
                                          >
                                            <div className="kitchen-number-line">
                                              <strong className="kitchen-quantity">
                                                {
                                                  item.quantity
                                                }
                                                ×
                                              </strong>

                                              <strong className="kitchen-item-number">
                                                {item
                                                        .menuItem
                                                        ?.item_number ??
                                                    "?"}
                                              </strong>
                                            </div>

                                            {item.note && (
                                                <div className="kitchen-item-note">
                                                  📝{" "}
                                                  {
                                                    item.note
                                                  }
                                                </div>
                                            )}
                                          </div>
                                      )
                                  )
                              ) : (
                                  <p>
                                    Keine Produkte
                                    gefunden.
                                  </p>
                              )}
                            </div>

                            {order.note && (
                                <div className="kitchen-order-note">
                                  <strong>
                                    Hinweis:
                                  </strong>{" "}
                                  {order.note}
                                </div>
                            )}

                            <div className="kitchen-order-actions">
                              <button
                                  className="kitchen-done-button"
                                  onClick={() =>
                                      markDone(
                                          order.id
                                      )
                                  }
                              >
                                ✓ Fertig
                              </button>
                            </div>
                          </div>
                      )
                  )}
                </div>
            )}
          </main>
        </div>
    );
  }

  /* =========================
     BESTELLSEITE
  ========================= */

  if (selectedOrderType) {
    return (
        <div className="app">
          <header className="topbar">
            <button
                className="back-button"
                onClick={() => {
                  setSelectedOrderType(
                      null
                  );

                  setCart([]);
                  setSearch("");
                  setSelectedCategory(
                      "Alle"
                  );
                  setOrderMessage("");
                }}
            >
              ← Zurück
            </button>

            <div className="table-heading">
              <h1>
                {
                  selectedOrderType.icon
                }{" "}
                {
                  selectedOrderType.label
                }
              </h1>

              <span>
              Neue Bestellung
            </span>
            </div>

            <div className="cart-count">
              {cartQuantity} Artikel
            </div>
          </header>

          <main className="ordering-layout">
            <section className="menu-area">
              <div className="menu-tools">
                <input
                    className="search-input"
                    type="text"
                    placeholder="🔎 Nummer oder Gericht suchen..."
                    value={search}
                    onChange={(e) =>
                        setSearch(
                            e.target.value
                        )
                    }
                />

                <div className="category-row">
                  {categories.map(
                      (category) => (
                          <button
                              key={category}
                              className={
                                selectedCategory ===
                                category
                                    ? "category-button active"
                                    : "category-button"
                              }
                              onClick={() =>
                                  setSelectedCategory(
                                      category
                                  )
                              }
                          >
                            {category}
                          </button>
                      )
                  )}
                </div>
              </div>

              <div className="product-grid">
                {filteredItems.length ===
                    0 && (
                        <p>
                          Keine Gerichte
                          gefunden.
                        </p>
                    )}

                {filteredItems.map(
                    (item) => (
                        <button
                            key={item.id}
                            className="product-card"
                            onClick={() =>
                                openItemModal(
                                    item
                                )
                            }
                        >
                          <div className="product-number">
                            {
                              item.item_number
                            }
                          </div>

                          <div className="product-name">
                            {item.name}
                          </div>

                          <div className="product-bottom">
                      <span>
                        {Number(
                            item.price ||
                            0
                        ).toFixed(
                            2
                        )}{" "}
                        €
                      </span>

                            <span className="add-symbol">
                        +
                      </span>
                          </div>
                        </button>
                    )
                )}
              </div>
            </section>

            <aside className="cart-panel">
              <div className="cart-header">
                <div>
                  <h2>
                    Bestellung
                  </h2>

                  <p>
                    {
                      selectedOrderType.icon
                    }{" "}
                    {
                      selectedOrderType.label
                    }
                  </p>
                </div>
              </div>

              {cart.length === 0 ? (
                  <div className="empty-cart">
                    <div>🛒</div>

                    <p>
                      Noch keine Gerichte
                      ausgewählt.
                    </p>
                  </div>
              ) : (
                  <div className="cart-items">
                    {cart.map(
                        (item) => (
                            <div
                                className="cart-item"
                                key={
                                  item.cartId
                                }
                            >
                              <div className="cart-item-info">
                                <strong className="cart-item-number">
                                  Nr.{" "}
                                  {
                                    item.item_number
                                  }
                                </strong>

                                {item.note && (
                                    <span className="cart-note">
                            📝{" "}
                                      {
                                        item.note
                                      }
                          </span>
                                )}

                                <span>
                          {(
                              Number(
                                  item.price ||
                                  0
                              ) *
                              item.quantity
                          ).toFixed(
                              2
                          )}{" "}
                                  €
                        </span>
                              </div>

                              <div className="quantity-controls">
                                <button
                                    type="button"
                                    onClick={() =>
                                        decreaseQuantity(
                                            item.cartId
                                        )
                                    }
                                >
                                  −
                                </button>

                                <strong>
                                  {
                                    item.quantity
                                  }
                                </strong>

                                <button
                                    type="button"
                                    onClick={() =>
                                        increaseQuantity(
                                            item.cartId
                                        )
                                    }
                                >
                                  +
                                </button>
                              </div>
                            </div>
                        )
                    )}
                  </div>
              )}

              <div className="cart-footer">
                <div className="total-row">
                  <span>Gesamt</span>

                  <strong>
                    {cartTotal.toFixed(
                        2
                    )}{" "}
                    €
                  </strong>
                </div>

                <button
                    className="send-order-button"
                    onClick={sendOrder}
                    disabled={
                        cart.length === 0 ||
                        sendingOrder
                    }
                >
                  {sendingOrder
                      ? "Wird gesendet..."
                      : "Bestellung senden"}
                </button>

                {orderMessage && (
                    <p className="order-message">
                      {orderMessage}
                    </p>
                )}
              </div>
            </aside>
          </main>

          {selectedMenuItem && (
              <div
                  className="item-modal-overlay"
                  onClick={
                    closeItemModal
                  }
              >
                <div
                    className="item-modal"
                    onClick={(e) =>
                        e.stopPropagation()
                    }
                >
                  <button
                      className="modal-close-button"
                      onClick={
                        closeItemModal
                      }
                  >
                    ×
                  </button>

                  <div className="modal-item-number">
                    {
                      selectedMenuItem.item_number
                    }
                  </div>

                  <div className="modal-quantity-section">
                    <label>
                      Menge
                    </label>

                    <div className="modal-quantity-controls">
                      <button
                          type="button"
                          onClick={() =>
                              setModalQuantity(
                                  (q) =>
                                      Math.max(
                                          1,
                                          q - 1
                                      )
                              )
                          }
                      >
                        −
                      </button>

                      <strong>
                        {modalQuantity}
                      </strong>

                      <button
                          type="button"
                          onClick={() =>
                              setModalQuantity(
                                  (q) =>
                                      q + 1
                              )
                          }
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="modal-note-section">
                    <label>
                      Notiz{" "}
                      <span>
                    (optional)
                  </span>
                    </label>

                    <textarea
                        value={modalNote}
                        onChange={(e) =>
                            setModalNote(
                                e.target.value
                            )
                        }
                        placeholder="z.B. extra scharf, ohne Zwiebeln, Reis statt Nudeln..."
                        rows="4"
                        autoFocus
                    />
                  </div>

                  <div className="modal-buttons">
                    <button
                        className="modal-cancel-button"
                        onClick={
                          closeItemModal
                        }
                    >
                      Abbrechen
                    </button>

                    <button
                        className="modal-add-button"
                        onClick={
                          addConfiguredItemToCart
                        }
                    >
                      Hinzufügen
                    </button>
                  </div>
                </div>
              </div>
          )}
        </div>
    );
  }

  /* =========================
     STARTSEITE
  ========================= */

  return (
      <div className="app">
        <header className="topbar">
          <div>
            <h1>Little Asia</h1>
            <p>Bestellsystem</p>
          </div>

          <div
              style={{
                display: "flex",
                gap: "10px",
              }}
          >
            <button
                className="primary-button kitchen-top-button"
                onClick={async () => {
                  await unlockKitchenSound();
                  await loadKitchenOrders();

                  setView("kitchen");
                }}
            >
              🍳 Küche
            </button>

            <button
                className="logout-button"
                onClick={logout}
            >
              Abmelden
            </button>
          </div>
        </header>

        <main className="content">
          <div className="section-title">
            <h2>
              Neue Bestellung
            </h2>

            <span>
            Bestellart auswählen
          </span>
          </div>

          <div className="table-grid order-type-grid">
            <button
                className="table-card order-type-card"
                onClick={() =>
                    chooseOrderType(
                        "dinein"
                    )
                }
            >
            <span className="table-icon">
              🍽️
            </span>

              <strong>
                ĂN Ở ĐÂY
              </strong>
            </button>

            <button
                className="table-card takeaway-card order-type-card"
                onClick={() =>
                    chooseOrderType(
                        "takeaway"
                    )
                }
            >
            <span className="table-icon">
              🥡
            </span>

              <strong>
                MANG VỀ
              </strong>
            </button>
          </div>

          {message && (
              <p className="message">
                {message}
              </p>
          )}
        </main>
      </div>
  );
}

export default App;