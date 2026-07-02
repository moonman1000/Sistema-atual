"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Truck, CheckCircle, XCircle, AlertCircle, LogOut, MapPin, Navigation } from "lucide-react";
import { toast } from "sonner";
import { useDeliveries, Delivery } from "@/context/DeliveryContext";
import { useOrders } from "@/context/OrderContext";
import { useRestaurant } from "@/context/RestaurantContext";
import { getBusinessDateString, cn, slugify, createLocalDate } from "@/lib/utils";
import OrderTrackingMap from "@/components/sales/OrderTrackingMap";
import { supabase } from '@/integrations/supabase/client';
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useSession } from '@/context/SessionContext';

const TRACKING_BASE_URL = "https://agoravai14.onrender.com";

const DeliveryDriverPage = () => {
  const { deliveries, isLoadingDeliveries, fetchDeliveries, updateDelivery } = useDeliveries();
  const { orders, isLoadingOrders, updateOrder } = useOrders();
  const { currentRestaurant, isLoadingRestaurants, setCurrentRestaurant, allRestaurants } = useRestaurant();
  const { softRevalidateSession } = useSession();

  const [driverName, setDriverName] = useState<string>(localStorage.getItem('deliveryDriverName') || '');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(!!localStorage.getItem('deliveryDriverName'));
  const [loginInput, setLoginInput] = useState<string>('');
  const [restaurantIdentifierInput, setRestaurantIdentifierInput] = useState<string>(localStorage.getItem('deliveryDriverRestaurantId') || '');
  const [showMapForDelivery, setShowMapForDelivery] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [problemDescription, setProblemDescription] = useState<string>('');
  const [activeProblemDeliveryId, setActiveProblemDeliveryId] = useState<string | null>(null);
  const [pendingStatusUpdate, setPendingStatusUpdate] = useState<Delivery["status"] | null>(null);

  // ✅ CORRIGIDO: isLoading não bloqueia mais quando é entregador externo (sem sessão)
  const isLoading = isLoadingDeliveries || isLoadingOrders;

  const resolveRestaurantIdentifierToId = useCallback((identifier: string): string | undefined => {
    let cleanedIdentifier = identifier.startsWith('/') ? identifier.split('/').pop() || '' : identifier;
    if (!cleanedIdentifier) return undefined;

    let foundRestaurant = allRestaurants.find(r => r.slug === cleanedIdentifier);

    if (!foundRestaurant) {
      const normalizedIdentifier = slugify(cleanedIdentifier);
      if (normalizedIdentifier !== cleanedIdentifier) {
        foundRestaurant = allRestaurants.find(r => r.slug === normalizedIdentifier);
      }
    }

    if (!foundRestaurant && cleanedIdentifier.length === 36 && cleanedIdentifier.includes('-')) {
      foundRestaurant = allRestaurants.find(r => r.id === cleanedIdentifier);
    }

    return foundRestaurant?.id;
  }, [allRestaurants]);

  // ✅ CORRIGIDO: ao montar, se já estava logado, busca entregas imediatamente
  useEffect(() => {
    const storedResolvedId = localStorage.getItem('deliveryDriverRestaurantResolvedId');
    if (isLoggedIn && driverName && storedResolvedId) {
      // Setar restaurante atual se ainda não estiver setado
      if (!currentRestaurant) {
        const found = allRestaurants.find(r => r.id === storedResolvedId) || null;
        if (found) setCurrentRestaurant(found);
      }
      fetchDeliveries(storedResolvedId);
    }
  }, [isLoggedIn, driverName]);

  const handleLogin = async () => {
    if (!loginInput.trim()) {
      toast.error("Por favor, digite seu nome.");
      return;
    }
    if (!restaurantIdentifierInput.trim()) {
      toast.error("Por favor, digite o ID ou Slug do restaurante.");
      return;
    }

    setIsLoggingIn(true);
    try {
      const resolvedRestaurantId = resolveRestaurantIdentifierToId(restaurantIdentifierInput.trim());

      if (!resolvedRestaurantId) {
        toast.error("Restaurante não encontrado. Verifique o ID ou Slug do restaurante.");
        setIsLoggingIn(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('verify-driver-login', {
        body: {
          restaurantId: resolvedRestaurantId,
          driverName: loginInput.trim(),
        },
      });

      if (error) {
        console.error("Erro ao invocar Edge Function:", error);
        toast.error("Erro no servidor ao tentar login.");
        return;
      }

      if (data?.success) {
        setDriverName(data.driverName);
        setIsLoggedIn(true);
        localStorage.setItem('deliveryDriverName', data.driverName);
        localStorage.setItem('deliveryDriverRestaurantId', restaurantIdentifierInput.trim());
        // ✅ CORRIGIDO: salvar o UUID resolvido para uso direto sem depender de sessão admin
        localStorage.setItem('deliveryDriverRestaurantResolvedId', resolvedRestaurantId);

        // ✅ CORRIGIDO: setar restaurante atual imediatamente
        const resolvedRestaurant = allRestaurants.find(r => r.id === resolvedRestaurantId) || null;
        setCurrentRestaurant(resolvedRestaurant);

        // ✅ CORRIGIDO: buscar entregas imediatamente passando o ID diretamente
        await fetchDeliveries(resolvedRestaurantId);

        toast.success(`Bem-vindo, ${data.driverName}!`);
        await softRevalidateSession();
      } else {
        toast.error("Nome de entregador não encontrado ou inativo. Verifique seu nome e o ID/Slug do restaurante.");
      }
    } catch (error) {
      console.error("Erro inesperado no login:", error);
      toast.error("Ocorreu um erro inesperado. Tente novamente.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setDriverName('');
    setIsLoggedIn(false);
    setLoginInput('');
    setRestaurantIdentifierInput('');
    localStorage.removeItem('deliveryDriverName');
    localStorage.removeItem('deliveryDriverRestaurantId');
    localStorage.removeItem('deliveryDriverRestaurantResolvedId');
    toast.info("Você foi desconectado.");
    setCurrentRestaurant(null);
  };

  const currentBusinessDate = getBusinessDateString();

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.table((deliveries || []).map(d => ({
        id: d.id,
        orderid: d.orderid,
        status: d.status,
        deliveryman: d.deliveryman,
        restaurant_id: d.restaurant_id,
        created_at: d.created_at,
      })));
      console.log('driverName raw (localStorage):', localStorage.getItem('deliveryDriverName'));
      console.log('driverName state normalized:', String(driverName || '').trim().toLowerCase());
      console.log('currentBusinessDate:', currentBusinessDate, 'currentRestaurant.id:', currentRestaurant?.id);
    }
  }, [deliveries, driverName, currentBusinessDate, currentRestaurant?.id]);

  const assignedDeliveries = useMemo(() => {
    if (!isLoggedIn || !driverName || !deliveries) return [];

    const businessDateString = currentBusinessDate;
    const normalizedDriver = String(driverName || '').trim().toLowerCase();
    const statusesToExclude = new Set(['Entregue', 'Cancelado']);

    return (deliveries || [])
      .filter((delivery) => {
        if (!delivery) return false;

        const resolvedId = localStorage.getItem('deliveryDriverRestaurantResolvedId');
        const restaurantIdToCheck = currentRestaurant?.id || resolvedId;
        if (restaurantIdToCheck && String(delivery.restaurant_id ?? '') !== String(restaurantIdToCheck)) {
          return false;
        }

        const deliveryman = String(delivery.deliveryman ?? '').trim().toLowerCase();
        if (!deliveryman) return false;
        if (deliveryman !== normalizedDriver) return false;

        const status = String(delivery.status ?? '').trim();
        if (statusesToExclude.has(status)) return false;

        if (delivery.problem_resolved === true) return false;

        const createdAtRaw = delivery.created_at ?? delivery.updated_at ?? null;
        if (createdAtRaw) {
          const createdDate = createLocalDate(createdAtRaw.split('T')[0]);
          const createdDateStringUTC = createdDate?.toISOString().split('T')[0];
          if (createdDateStringUTC !== businessDateString) return false;
        } else {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const businessDate = currentBusinessDate;
        const timeA = a.estimateddeliverytime;
        const timeB = b.estimateddeliverytime;

        const dateTimeA = timeA ? new Date(createLocalDate(businessDate)).setHours(parseInt(timeA.split(':')[0]), parseInt(timeA.split(':')[1])) : Number.POSITIVE_INFINITY;
        const dateTimeB = timeB ? new Date(createLocalDate(businessDate)).setHours(parseInt(timeB.split(':')[0]), parseInt(timeB.split(':')[1])) : Number.POSITIVE_INFINITY;

        return dateTimeA - dateTimeB;
      });
  }, [isLoggedIn, driverName, deliveries, currentBusinessDate, currentRestaurant?.id]);

  const handleUpdateStatus = async (delivery: Delivery, newStatus: Delivery["status"]) => {
    const resolvedId = localStorage.getItem('deliveryDriverRestaurantResolvedId');
    const restaurantId = currentRestaurant?.id || resolvedId;

    if (!restaurantId) {
      toast.error("Dados do restaurante não disponíveis.");
      return;
    }

    let descriptionToSend: string | undefined = undefined;
    let problemResolvedStatus: boolean = false;

    if (newStatus === "Entregue") {
      problemResolvedStatus = true;
    } else if (newStatus === "Problema" || newStatus === "Recusado" || newStatus === "Devolvido") {
      descriptionToSend = problemDescription.trim();
      if (!descriptionToSend) {
        toast.error("Por favor, descreva o motivo do problema/recusa/devolução.");
        return;
      }
      problemResolvedStatus = false;
    }

    const updatedDelivery: Delivery = {
      ...delivery,
      status: newStatus,
      actualdeliverytime: newStatus === "Entregue" ? new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : undefined,
      problem_description: descriptionToSend,
      problem_resolved: problemResolvedStatus,
      updated_at: new Date().toISOString(),
    };

    try {
      await updateDelivery(updatedDelivery);
      toast.success(`Entrega ${delivery.orderid} atualizada para "${newStatus}"!`);

      const orderToUpdate = orders.find(o => o.id === delivery.orderid);
      if (orderToUpdate && orderToUpdate.status !== newStatus) {
        await updateOrder({ ...orderToUpdate, status: newStatus });
      }
      setProblemDescription('');
      setActiveProblemDeliveryId(null);
      setPendingStatusUpdate(null);
    } catch (error) {
      console.error("Erro ao atualizar status da entrega:", error);
      toast.error("Falha ao atualizar status da entrega.");
    }
  };

  const getStatusBadgeVariant = (status: Delivery["status"]) => {
    switch (status) {
      case "Atribuído": return "default";
      case "Em Entrega": return "secondary";
      case "Entregue": return "success";
      case "Problema": return "destructive";
      case "Recusado": return "destructive";
      case "Devolvido": return "destructive";
      default: return "outline";
    }
  };

  const handleProblemButtonClick = (deliveryId: string, statusToSet: Delivery["status"], currentDescription?: string) => {
    if (activeProblemDeliveryId === deliveryId && pendingStatusUpdate === statusToSet) {
      setActiveProblemDeliveryId(null);
      setProblemDescription('');
      setPendingStatusUpdate(null);
    } else {
      setActiveProblemDeliveryId(deliveryId);
      setProblemDescription(currentDescription || '');
      setPendingStatusUpdate(statusToSet);
    }
  };

  const handleOpenMaps = (address: string) => {
    if (!address) {
      toast.error("Endereço do cliente não informado.");
      return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
    window.open(url, "_blank");
  };

  const handleOpenRealtimeTracking = (orderId: string) => {
    if (!orderId) {
      toast.error("ID do pedido não disponível.");
      return;
    }
    window.open(
      `${TRACKING_BASE_URL}/motorista.html?orderId=${orderId}`,
      "_blank"
    );
  };

  if (isLoading && isLoggedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2">Carregando entregas...</p>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Truck className="h-12 w-12 mx-auto text-primary mb-4" />
            <CardTitle className="text-2xl font-bold">Login do Entregador</CardTitle>
            <CardDescription>Digite seu nome e o identificador do restaurante para acessar suas entregas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="Seu nome completo"
              value={loginInput}
              onChange={(e) => setLoginInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              disabled={isLoggingIn}
            />
            <Input
              placeholder="ID ou Slug do Restaurante"
              value={restaurantIdentifierInput}
              onChange={(e) => setRestaurantIdentifierInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              disabled={isLoggingIn}
            />
            <Button onClick={handleLogin} className="w-full" disabled={isLoggingIn}>
              {isLoggingIn ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Entrando...
                </>
              ) : (
                "Entrar"
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Truck className="h-7 w-7" /> Minhas Entregas ({driverName})
        </h1>
        <Button variant="outline" onClick={handleLogout}>
          <LogOut className="h-4 w-4 mr-2" /> Sair
        </Button>
      </div>

      <CardDescription>
        Entregas atribuídas a você para o dia de negócio atual ({currentBusinessDate}).
      </CardDescription>

      {assignedDeliveries.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/50">
          <h3 className="text-xl font-semibold mb-2">Nenhuma entrega atribuída para hoje.</h3>
          <p className="text-muted-foreground">Aproveite seu dia ou aguarde novas atribuições!</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {assignedDeliveries.map((delivery) => (
            <Card key={delivery.id} className="shadow-md">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg">Pedido: {delivery.orderid}</CardTitle>
                <Badge variant={getStatusBadgeVariant(delivery.status)}>{delivery.status}</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Cliente: <span className="font-medium text-foreground">{delivery.clientname}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Endereço: <span className="font-medium text-foreground">{delivery.client_address}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Estimativa: <span className="font-medium text-foreground">{delivery.estimateddeliverytime}</span>
                </p>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => handleOpenMaps(delivery.client_address)}
                    className="flex-1 min-w-[140px]"
                  >
                    <Navigation className="h-4 w-4 mr-2" />
                    Abrir rota no Google Maps
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => handleOpenRealtimeTracking(delivery.orderid)}
                    className="flex-1 min-w-[140px]"
                  >
                    <Truck className="h-4 w-4 mr-2" />
                    Rastrear (tempo real)
                  </Button>
                </div>

                {delivery.trackinglink && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-primary" />
                    <Button variant="link" className="p-0 h-auto" onClick={() => setShowMapForDelivery(showMapForDelivery === delivery.id ? null : delivery.id)}>
                      {showMapForDelivery === delivery.id ? "Esconder mapa" : "Ver no mapa"}
                    </Button>
                  </div>
                )}

                {showMapForDelivery === delivery.id && delivery.trackinglink && (
                  <div className="mt-4">
                    <OrderTrackingMap trackinglink={delivery.trackinglink} />
                  </div>
                )}

                {(activeProblemDeliveryId === delivery.id && (pendingStatusUpdate === "Problema" || pendingStatusUpdate === "Recusado" || pendingStatusUpdate === "Devolvido")) && (
                  <div className="space-y-2 mt-4">
                    <Label htmlFor={`problem-description-${delivery.id}`}>
                      Motivo do {pendingStatusUpdate === "Recusado" ? "Recusa" : pendingStatusUpdate === "Devolvido" ? "Devolução" : "Problema"}
                    </Label>
                    <Textarea
                      id={`problem-description-${delivery.id}`}
                      value={problemDescription}
                      onChange={(e) => setProblemDescription(e.target.value)}
                      placeholder="Descreva o motivo..."
                      rows={3}
                    />
                    <Button
                      onClick={() => pendingStatusUpdate && handleUpdateStatus(delivery, pendingStatusUpdate)}
                      className={cn(
                        "w-full",
                        pendingStatusUpdate === "Recusado" || pendingStatusUpdate === "Devolvido"
                          ? "bg-red-500 hover:bg-red-600 text-white"
                          : "bg-orange-500 hover:bg-orange-600 text-white"
                      )}
                    >
                      Confirmar {pendingStatusUpdate === "Recusado" ? "Recusa" : pendingStatusUpdate === "Devolvido" ? "Devolução" : "Problema"}
                    </Button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-4 border-t mt-4">
                  <Button
                    onClick={() => handleUpdateStatus(delivery, "Entregue")}
                    className="bg-green-500 hover:bg-green-600 text-white flex-1 min-w-[120px]"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" /> Entregue
                  </Button>
                  <Button
                    onClick={() => handleProblemButtonClick(delivery.id, "Devolvido", delivery.problem_description)}
                    className={cn(
                      "flex-1 min-w-[120px]",
                      activeProblemDeliveryId === delivery.id && pendingStatusUpdate === "Devolvido"
                        ? "bg-red-700"
                        : "bg-red-500 hover:bg-red-600 text-white"
                    )}
                  >
                    <XCircle className="h-4 w-4 mr-2" /> Devolvido
                  </Button>
                  <Button
                    onClick={() => handleProblemButtonClick(delivery.id, "Problema", delivery.problem_description)}
                    variant="outline"
                    className={cn(
                      "flex-1 min-w-[120px]",
                      activeProblemDeliveryId === delivery.id && pendingStatusUpdate === "Problema"
                        ? "bg-orange-500 hover:bg-orange-600 text-white"
                        : ""
                    )}
                  >
                    <AlertCircle className="h-4 w-4 mr-2" /> Não Entregue
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default DeliveryDriverPage;
