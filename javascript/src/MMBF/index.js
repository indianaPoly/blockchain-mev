import { request, gql } from "graphql-request";
import { loadAllPoolsFromV3 } from "../pools.js";

const getPoolInformation = async () => {
  const pools = await loadAllPoolsFromV3();
}

const calculateBasePrice = (min, max) => {
    return (min + max) / 2;
};

/**
 * @param {number} currentPrice v_i, v_j 사이의 현재 가격
 * @param {number} basePrice v_i, v_j 평균가격
 */
const calculateEdgeWeight = (currentPrice, basePrice) => {
    return -Math.log10(currentPrice / basePrice);
};

const getPriceFromEdgeWeight = (sqrtPrice) => {
    return Math.pow(sqrtPrice, 2);
};

const getPriceFromTick = (tick) => {
    return Math.pow(1.0001, tick);
};

/**
 * @returns {Promise<any[]>}
 */
const fetchLiquidityPools = async () => {
    const BASE_URL = "https://gateway.thegraph.com/api";
    const API_KEY = "36d967a9b4c1e94751dc4eb807acacb0";
    const ID = "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV";
    const SUBGRAPH_URL = `${BASE_URL}/${API_KEY}/subgraphs/id/${ID}`;

    const query = `
    {
        pools(first: 50) {
            id
            token0 {
                id
                symbol
            }
            token1 {
                id
                symbol
            }
            tick
            sqrtPrice
        }
    }
    `;

    try {
        const data = await request(SUBGRAPH_URL, query);

        console.log("data fetch successful!");
        return data.pools;
    } catch (error) {
        console.log(error);
    }
};

const constructTokenGraph = async () => {
    const pools = await fetchLiquidityPools();

    const graph = {
        nodes: new Set(),
        edges: [],
    };

    pools.forEach((pool) => {
        const token0Address = pool.token0.id;
        const token1Address = pool.token1.id;

        graph.nodes.add(token0Address);
        graph.nodes.add(token1Address);

        const sqrtPrice = Number(pool.sqrtPrice);
        const currentPrice0to1 = getPriceFromEdgeWeight(sqrtPrice);
        const currentPrice1to0 = 1 / currentPrice0to1;

        const tick = parseInt(pool.tick);
        const tickRange = 10000;
        const priceMin = getPriceFromTick(tick - tickRange);
        const priceMax = getPriceFromTick(tick + tickRange);
        const basePrice = calculateBasePrice(priceMin, priceMax);

        const weight0to1 = calculateEdgeWeight(currentPrice0to1, basePrice);
        const weight1to0 = calculateEdgeWeight(currentPrice1to0, basePrice);

        if (!isNaN(weight0to1)) {
            graph.edges.push({
                from: {
                    name: pool.token0.symbol,
                    address: token0Address,
                },
                to: {
                    name: pool.token1.symbol,
                    address: token1Address,
                },
                weight: weight0to1,
            });
        }

        if (!isNaN(weight1to0)) {
            graph.edges.push({
                from: {
                    name: pool.token1.symbol,
                    address: token1Address,
                },
                to: {
                    name: pool.token0.symbol,
                    address: token0Address,
                },
                weight: weight1to0,
            });
        }
    });

    console.log("token graph successful!");
    return graph;
};

/**
 *
 * @param {{nodes: Set<any>; edges: never[];}} graph
 */
const constructLineGraph = (graph) => {
    const lineGraph = {
        nodes: new Set(),
        edges: [],
    };

    // Step 1: Create nodes in the line graph corresponding to each edge in the original graph
    const edgeToNodeMap = {}; // Map each original edge to a new node in the line graph
    graph.edges.forEach((edge) => {
        const lineGraphNode = { from: edge.from, to: edge.to };
        const nodeKey = `${edge.from.address}-${edge.to.address}`;
        lineGraph.nodes.add(nodeKey);
        edgeToNodeMap[nodeKey] = lineGraphNode;
    });

    // Step 2: Connect nodes in the line graph based on the rules
    graph.edges.forEach((edge1) => {
        const nodeKey1 = `${edge1.from.address}-${edge1.to.address}`;

        graph.edges.forEach((edge2) => {
            if (
                edge1.to.address === edge2.from.address &&
                edge1.from.address !== edge2.to.address
            ) {
                const nodeKey2 = `${edge2.from.address}-${edge2.to.address}`;
                const newEdge = {
                    from: edgeToNodeMap[nodeKey1],
                    to: edgeToNodeMap[nodeKey2],
                    weight: edge2.weight,
                };
                lineGraph.edges.push(newEdge);
            }
        });
    });

    const filteredEdges = [];
    const visitedPairs = new Set();

    lineGraph.edges.forEach((edge) => {
        const pairKey = `${edge.from.from.address}_${edge.from.to.address}_${edge.to.from.address}_${edge.to.to.address}`;
        const reversePairKey = `${edge.to.from.address}_${edge.to.to.address}_${edge.from.from.address}_${edge.from.to.address}`;

        if (!visitedPairs.has(reversePairKey)) {
            filteredEdges.push(edge);
            visitedPairs.add(pairKey);
        }
    });

    lineGraph.edges = filteredEdges;

    console.log("line graph constructed successfully!");
    return lineGraph;
};

const modifiedMooreBellmanFord = (lineGraph, sourceVertex) => {
    const Dis = new Map(); // 거리 저장
    const Path = new Map(); // 경로 저장

    // Dis와 Path 초기화
    for (const node of lineGraph.nodes) {
        Dis.set(node, Infinity);
        Path.set(node, []);
    }
    Dis.set(sourceVertex, 0);

    // MMBF 알고리즘 수행
    for (let m = 1; m <= lineGraph.nodes.size; m++) {
        for (const edge of lineGraph.edges) {
            const fromNode = `${edge.from.from.address}-${edge.from.to.address}`;
            const toNode = `${edge.to.from.address}-${edge.to.to.address}`;
            const weight = edge.weight;

            if (Dis.get(fromNode) + weight < Dis.get(toNode)) {
                Dis.set(toNode, Dis.get(fromNode) + weight);
                Path.set(toNode, [...Path.get(fromNode), edge.to]);
            }
        }
    }

    // D_token과 P_token 계산
    const D_token = {};
    const P_token = {};

    for (const [key, value] of Object.entries(Dis)) {
        const t = key.split("-")[1]; // 최종 목적 토큰 주소
        if (value < (D_token[t] || Infinity)) {
            D_token[t] = value;
            P_token[t] = Path[key];
        }
    }

    return { D_token, P_token };
};

const tx = async () => {
    const graph = await constructTokenGraph();
    const lineGraph = constructLineGraph(graph);

    const sourceVertex =
        "0x6aa56e1d98b3805921c170eb4b3fe7d4fda6d89b-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

    // MMBF 알고리즘 실행
    const result = modifiedMooreBellmanFord(lineGraph, sourceVertex);

    console.log("D_token:", result.D_token);
    console.log("P_token:", result.P_token);
};

await tx();
