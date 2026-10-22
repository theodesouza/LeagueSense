/**
 * Respostas no formato REAL do OP.GG MCP (estrutura verificada em 22/10/2026), reduzidas.
 * Os números são ilustrativos; o que importa para os testes é o formato.
 */
export const CHAMPION_LIST = `class LolListChampions: data
class Data: champions
class Champion: champion_id,key,name

LolListChampions(Data([Champion(103,"Ahri","Ahri"),Champion(157,"Yasuo","Yasuo"),Champion(412,"Thresh","Thresh"),Champion(62,"MonkeyKing","Wukong"),Champion(145,"Kaisa","Kai'Sa"),Champion(60001,"Jade_Annie","Annie"),Champion(20,"Nunu","Nunu & Willump")]))`

export const LANE_META = `class LolListLaneMetaChampions: data
class Data: positions
class Positions: top,mid,jungle,adc,support
class Top: champion,play,win,pick_rate,role_rate,ban_rate

LolListLaneMetaChampions(Data(Positions([Top("Wukong",17973,9166,0.07,0.8,0.05)],[Top("Ahri",22867,11614,0.1,0.95,0.03),Top("Yasuo",21181,10654,0.09,0.59,0.25),Top("Campeao Inexistente",500,250,0.01,0.5,0.0)],[Top("Nunu & Willump",6217,3100,0.02,0.9,0.01)],[Top("Kai'Sa",50280,25140,0.15,0.99,0.1)],[Top("Thresh",30000,15000,0.1,0.9,0.09)])))`

export const ANALYSIS_BASE = `class LolGetChampionAnalysis: data
class Data: summary,trends
class Summary: positions
class Position: name,stats
class Stats: play,win_rate,role_rate,pick_rate,ban_rate
class Trends: win
class Win: version

LolGetChampionAnalysis(Data(Summary([Position("MID",Stats(16511,0.51,0.95,0.1,0.03))]),Trends(Win("16.21"))))`

export const SYNERGIES = `class LolGetChampionSynergies: data
class Data: synergies
class Synergie: synergy_champion_id,play,win

LolGetChampionSynergies(Data([Synergie(412,360,196),Synergie(145,100,0)]))`

export const MATCHUP_JSON = JSON.stringify({
  lang: 'en_US',
  position: 'mid',
  data: {
    summary: { id: 103 },
    counters: [
      { champion_id: 157, champion_name: 'Yasuo', play: 776, win: 378 },
      { champion_id: 238, champion_name: 'Zed', play: 754, win: 374 },
      { champion_id: 1, champion_name: 'Annie', play: 0, win: 0 }
    ],
    trends: { win: [{ version: '16.21', rate: 0.5079 }, { version: '16.20', rate: 0.51 }] }
  }
})

export const PATCH_PROBE = `class LolGetChampionAnalysis: data
class Data: trends
class Trends: win
class Win: version

LolGetChampionAnalysis(Data(Trends(Win("16.21"))))`
