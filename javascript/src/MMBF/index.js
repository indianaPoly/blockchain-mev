import { loadAllPoolsFromV3 } from '../pools.js';
import { generateTriangularPaths } from '../paths.js';
import { processPoolsInParallel } from '../multi.js';

/**
 * 시작 토큰에 대한 주소를 넣게 되면 그에 따른 pool에 대한 정보와 가격정보도 호출하는 함수
 * @param {string} startTokenAddress
 * @returns {Promise <
 * [key: string]: {
 *  address: string;
 *  version: number;
 *  token0: string;
 *  toten1: string;
 *  decimals0: number;
 *  decimals1: number;
 *  fee: string | number;
 *  sqrtPriceX96: BigInt;
 *  liquidity: BignInt;
 *  tick: BigInt;
 *  }
 * >}
 */
const getFilteringPoolState = async (startTokenAddress) => {
  let pools = await loadAllPoolsFromV3();
  console.log('존재하는 pool의 개수: ', Object.keys(pools).length);

  // filtering을 위한 path
  const paths = generateTriangularPaths(pools, startTokenAddress);
  pools = {};
  for (let path of paths) {
    pools[path.pool1.address] = path.pool1;
    pools[path.pool2.address] = path.pool2;
    pools[path.pool3.address] = path.pool3;
  }
  console.log(
    '필터링 이후에 남아있는 pool의 개수: ',
    Object.keys(pools).length,
  );

  // filtering된 pool에 대한 정보 가져오기
  const reserves = await processPoolsInParallel(Object.keys(pools));

  // pool의 정보와 reserves 정보를 합치기
  let poolReserveData = {};

  Object.keys(pools).forEach((poolAddress) => {
    // reserve 정보에 해당 pool에 대한 정보가 존재한다면
    if (reserves[poolAddress]) {
      poolReserveData[poolAddress] = {
        ...pools[poolAddress].toObject(),
        ...reserves[poolAddress],
      };
    }
  });

  return poolReserveData;
};

/**
 * 가장 큰 값과 작은 값을 넣었을 때 중간 값을 반환하는 함수
 * @param {BigInt} min
 * @param {BigInt} max
 * @returns {BigInt}
 */
const calculateBasePrice = (min, max) => {
  return (min + max) / BigInt(2);
};

/** 값이 작을 수록 현재 가격이 기준가격보다 높은 것을 의미함. (가중치를 낮게 부여)
 *  값이 클수록 현재 가격이 기준가격보다 낮은 것을 의미함. (가중치를 높게 부여)
 * @param {number} currentPrice v_i, v_j 사이의 현재 가격
 * @param {number} basePrice v_i, v_j 평균가격
 */
const calculateEdgeWeight = (currentPrice, basePrice) => {
  return -Math.log10(currentPrice / basePrice);
};

/**
 * sqrtPriceX96을 통해서 price 값을 리턴하는 함수
 * price = (sqrtPriceX96) ** 2 / 2 ** 192
 * @param {BigInt} sqrtPriceX96
 * @returns {BigInt}
 */
const getPriceFromEdgeWeight = (sqrtPriceX96) => {
  const a = sqrtPriceX96 * sqrtPriceX96;
  const b = BigInt(2 ** 192);
  return a / b;
};

/**
 * tick을 통해서 가격을 구하는 함수
 * @param {BigInt} tick
 * @returns {BigInt}
 */
const getPriceFromTick = (tick) => {
  const base = BigInt(1.0001);
  return base ** tick;
};

// sqrtPrcie, tick을 통한 graph 설정
const constructTokenGraph = async (startTokenAddress) => {
  const pools = await getFilteringPoolState(startTokenAddress);

  const graph = {
    nodes: new Set(),
    edges: [],
  };

  // pools를 순회하면서
  Object.keys(pools).forEach((poolAddress) => {
    const token0Address = pools[poolAddress].token0;
    const token1Address = pools[poolAddress].token1;

    // 1개 풀에 대한 token0, token1의 주소를 graph nodes에 추가
    graph.nodes.add(token0Address);
    graph.nodes.add(token1Address);

    // sqrtPriceX96을 통해서 얻은 price 값
    const price0to1OnSqrtPriceX96 = getPriceFromEdgeWeight(
      pools[poolAddress].sqrtPriceX96,
    );
    const price1to0OnSqrtPriceX96 =
      price0to1OnSqrtPriceX96 !== 0n ? BigInt(1) / price0to1OnSqrtPriceX96 : 0n;

    if (price0to1OnSqrtPriceX96 !== 0n && price1to0OnSqrtPriceX96 !== 0n) {
      if (price1to0OnSqrtPriceX96 !== 0n) {
        // tick을 통해서 basePrice 설정
        const tick = BigInt(pools[poolAddress].tick); // base price
        if (tick !== 0n) {
          const tickRange = BigInt(20000);
          const priceMin = getPriceFromTick(tick - tickRange);
          const priceMax = getPriceFromTick(tick + tickRange);
          const basePrice = calculateBasePrice(priceMin, priceMax);

          // sqrtPrice를 통해서 얻은 값과 tick을 통해서 edge를 설정함. (함수 및 이후 로직 수정이 되어야 함.)
          const weight0to1 = calculateEdgeWeight(
            price0to1OnSqrtPriceX96,
            basePrice,
          );
          const weight1to0 = calculateEdgeWeight(
            price1to0OnSqrtPriceX96,
            basePrice,
          );

          // token0 -> token1로 가는 가중치가 NaN이 아니라면
          if (!isNaN(weight0to1)) {
            // 그래프 간선으로 추가를 함.
            graph.edges.push({
              from: {
                address: token0Address,
              },
              to: {
                address: token1Address,
              },
              weight: weight0to1,
            });
          }

          // token1 -> token0로 가는 가중치가 NaN이 아니라면
          if (!isNaN(weight1to0)) {
            graph.edges.push({
              from: {
                address: token1Address,
              },
              to: {
                address: token0Address,
              },
              weight: weight1to0,
            });
          }
        }
      }
    }
  });

  console.log('token graph successful!');
  return graph;
};

/**
 * 가격정보를 기반의 그래프를 선그래프로 변환 하는 함수
 * @param {{nodes: Set<any>; edges: [];}} graph
 * @returns {{nodes: Set<any>; edges: [];}}
 */
const constructLineGraph = (graph) => {
  const lineGraph = {
    nodes: new Set(),
    edges: [],
  };

  // edgeToNodeMap data structure
  // {
  //   [nodeKey: string]: {
  //     from : {
  //       address: string,
  //     },
  //     to : {
  //       address: string
  //     }
  //   }
  // }
  const edgeToNodeMap = {};

  // 가격정보 기반 그래프의 간선을 순회하면서
  graph.edges.forEach((edge) => {
    // 간선의 address를 기반으로 node key를 설정
    const nodeKey = `${edge.from.address}-${edge.to.address}`;
    // node key를 선 그래프의 노드로 설정
    lineGraph.nodes.add(nodeKey);
    // node key에 대해서 edge 정보를 저장
    edgeToNodeMap[nodeKey] = edge;
  });

  // 간선을 총 2번 순회하며, from, to와 연결된 것에 대한 정보 추출
  graph.edges.forEach((edge1) => {
    const nodeKey1 = `${edge1.from.address}-${edge1.to.address}`;

    graph.edges.forEach((edge2) => {
      // 사이클 형성을 방지
      if (
        edge1.to.address === edge2.from.address &&
        edge1.from.address !== edge2.to.address
      ) {
        const nodeKey2 = `${edge2.from.address}-${edge2.to.address}`;

        // nodeKey1, nodeKey2 데이터가 edgeToNodeMap의 데이터에 존재한다면
        if (edgeToNodeMap[nodeKey1] && edgeToNodeMap[nodeKey2]) {
          // 선 그래프에 대한 엣지를 추가
          const newEdge = {
            from: edgeToNodeMap[nodeKey1],
            to: edgeToNodeMap[nodeKey2],
            weight: edge2.weight,
          };
          lineGraph.edges.push(newEdge);
        }
      }
    });
  });

  // 선 그래프의 Edge에 대한 filtering 진행 => 필터링에 대한 명백한 이유가 존재
  const filteredEdges = [];
  const visitedPairs = new Set();

  // 선그래프의 edge에 대해서
  lineGraph.edges.forEach((edge) => {
    // 선그래프의 edge에 대해서 pair 키 (2개의 pool에 대한)를 형셩
    const pairKey = `${edge.from.from.address}-${edge.from.to.address}-${edge.to.from.address}-${edge.to.to.address}`;
    const reversePairKey = `${edge.to.from.address}-${edge.to.to.address}-${edge.from.from.address}-${edge.from.to.address}`;

    // reserve 키에 대해서 방문한 기록이 없다면
    if (!visitedPairs.has(reversePairKey)) {
      filteredEdges.push(edge);
      visitedPairs.add(pairKey);
    }
  });

  // 필터링한 edge에 대해서 edge 업데이트를 진행
  lineGraph.edges = filteredEdges;

  console.log('line graph constructed successfully!');
  return lineGraph;
};

const modifiedMooreBellmanFord = (lineGraph, sourceVertex) => {
  const Dis = new Map(); // 각 노드까지의 최단 거리를 저장
  const Path = new Map(); // 각 노드까지의 최단 경로를 저장

  // Dis와 Path 초기화
  for (const node of lineGraph.nodes) {
    Dis.set(node, Infinity); // 그래프의 모든 노드의 거리를 무한대로 설정
    Path.set(node, []); // 경로들은 빈 배열로 설정
  }
  Dis.set(sourceVertex, 0); // 시작 노드의 거리는 0으로 설정

  // lineGraph 노드의 사이즈 만큼을 반복하여 최단 거리를 업데이트
  for (let m = 1; m <= lineGraph.nodes.size; m++) {
    for (const edge of lineGraph.edges) {
      const fromNode = `${edge.from.from.address}-${edge.from.to.address}`;
      const toNode = `${edge.to.from.address}-${edge.to.to.address}`;
      const weight = edge.weight;

      // 현재 거리보다 더 짧은 거리를 발견하게 되면
      if (Dis.get(fromNode) + weight < Dis.get(toNode)) {
        Dis.set(toNode, Dis.get(fromNode) + weight);
        Path.set(toNode, [...Path.get(fromNode), edge.to]);
      }
    }
  }

  // D_token과 P_token 계산
  const D_token = {}; // 목적지 노드의 최단 거리 저장
  const P_token = {}; // 목적지 까지의 경로 저장

  for (const [key, value] of Dis.entries()) {
    const t = key.split('-')[1]; // 최종 목적 토큰 주소
    if (value < (D_token[t] || Infinity)) {
      D_token[t] = value;
      P_token[t] = Path[key];
    }
  }

  return { D_token, P_token };
};

const tx = async () => {
  const startTokenAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const sourceVertex =
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48-0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

  const graph = await constructTokenGraph(startTokenAddress);
  const lineGraph = constructLineGraph(graph);

  // MMBF 알고리즘 실행
  const { D_token, P_token } = modifiedMooreBellmanFord(
    lineGraph,
    sourceVertex,
  );

  console.log('D_token:', D_token);
  console.log('P_token:', P_token);
};

await tx();
