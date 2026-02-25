import { Team, Player, Match, GameState, PlayerAttributes, Position } from './types';
import { computeOverall } from './engine';

const TEAM_NAMES_L1 = ['Flamengo','Palmeiras','São Paulo','Corinthians','Atlético Mineiro','Fluminense','Grêmio','Internacional','Cruzeiro','Vasco da Gama'];
const TEAM_NAMES_L2 = ['Santos','Botafogo','Bahia','Athletico Paranaense','Fortaleza','Ceará','Goiás','Coritiba','Sport Recife','Vitória'];
const TEAM_NAMES_L3 = ['Ponte Preta','Guarani','Juventude','Criciúma','Vila Nova','CRB','Avaí','Chapecoense','Figueirense','Paysandu'];
const ALL_TEAM_NAMES = [...TEAM_NAMES_L1,...TEAM_NAMES_L2,...TEAM_NAMES_L3];
const COLORS = ['#C90000','#006437','#FF0000','#1C1C1C','#000000','#8A1538','#0D80BF','#E50000','#003A94','#8B0000','#F5F5F5','#111111','#0054A6','#C8102E','#0033A0','#111111','#008000','#006400','#CC0000','#FF6600','#333333','#228B22','#006400','#DAA520','#DC143C','#FF4500','#0000CD','#2E8B57','#1a1a1a','#000080'];
const FIRST_NAMES = ['João','Pedro','Lucas','Mateus','Gabriel','Guilherme','Rafael','Felipe','Thiago','Bruno','Rodrigo','Eduardo','Diego','Leonardo','Daniel','Marcelo','Gustavo','Henrique','Ricardo','Alexandre','Carlos','Paulo','Leandro','Anderson','Vinicius'];
const LAST_NAMES  = ['Silva','Santos','Oliveira','Souza','Rodrigues','Ferreira','Alves','Pereira','Lima','Gomes','Costa','Ribeiro','Martins','Carvalho','Almeida','Lopes','Soares','Fernandes','Vieira','Barbosa','Nascimento','Araújo','Rocha','Cavalcante','Moreira'];

function rnd(min:number,max:number){return Math.floor(Math.random()*(max-min+1))+min;}
export function randomName(){return `${FIRST_NAMES[rnd(0,FIRST_NAMES.length-1)]} ${LAST_NAMES[rnd(0,LAST_NAMES.length-1)]}`;}

function generateAttributes(pos:Position,base:number,potential:number):PlayerAttributes{
  const cap=Math.min(potential,99);
  type T='primary'|'secondary'|'weak';
  const profile:Record<Position,Record<keyof PlayerAttributes,T>>={
    G:{passe:'secondary',chute:'weak',drible:'weak',cruzamento:'weak',velocidade:'secondary',stamina:'secondary',forca:'primary',posicionamento:'primary',decisao:'primary',marcacao:'primary',disciplina:'primary',lideranca:'secondary'},
    D:{passe:'secondary',chute:'weak',drible:'weak',cruzamento:'secondary',velocidade:'primary',stamina:'secondary',forca:'primary',posicionamento:'primary',decisao:'primary',marcacao:'primary',disciplina:'secondary',lideranca:'secondary'},
    M:{passe:'primary',chute:'secondary',drible:'primary',cruzamento:'secondary',velocidade:'secondary',stamina:'primary',forca:'weak',posicionamento:'primary',decisao:'primary',marcacao:'secondary',disciplina:'secondary',lideranca:'secondary'},
    A:{passe:'secondary',chute:'primary',drible:'primary',cruzamento:'secondary',velocidade:'primary',stamina:'secondary',forca:'secondary',posicionamento:'primary',decisao:'primary',marcacao:'weak',disciplina:'secondary',lideranca:'secondary'},
  };
  const attrs:Partial<PlayerAttributes>={};
  for(const key of Object.keys(profile[pos]) as (keyof PlayerAttributes)[]){
    const tier=profile[pos][key];
    const val=tier==='primary'?rnd(base,base+15):tier==='secondary'?rnd(base-10,base+5):rnd(base-20,base);
    attrs[key]=Math.max(1,Math.min(cap,val));
  }
  return attrs as PlayerAttributes;
}

export function generatePlayer(teamId:string,pos:Position,league:number,overrideAge?:number,isYouth=false):Player{
  const base=Math.max(20,60-(league-1)*10-(isYouth?15:0));
  const age=overrideAge??rnd(18,33);
  const ageFactor=age<=21?15:age<=26?8:0;
  const potential=Math.min(99,base+rnd(5,20+ageFactor));
  const attributes=generateAttributes(pos,base,potential);
  const strength=computeOverall(attributes,pos);
  let value=Math.max(10_000,(strength-40)*400_000);
  if(age<23)value*=1.5;else if(age>28)value*=0.7;
  return {
    id:`${teamId}-p${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    name:randomName(),position:pos,strength,attributes,potential,age,teamId,
    energy:100,yellowCards:0,redCard:false,injuryWeeksLeft:0,
    matchesPlayed:0,goals:0,assists:0,trainingProgress:0,morale:80,
    salary:Math.max(1_000,Math.floor((strength-40)*8_000)),
    value:Math.floor(value),listedForSale:Math.random()<0.1,
    formStreak:0,isYouth,contractYears:rnd(1,4),
  };
}

function generatePlayersForTeam(teamId:string,league:number):Player[]{
  const positions:Position[]=['G','G','D','D','D','D','D','D','M','M','M','M','M','M','A','A','A','A'];
  return positions.map((pos,i)=>({...generatePlayer(teamId,pos,league),id:`${teamId}-p${i}`}));
}

export function generateFixtures(teams:Team[]):Match[]{
  const matches:Match[]=[];let matchId=Date.now();
  for(let league=1;league<=3;league++){
    const ids=teams.filter(t=>t.league===league).map(t=>t.id);
    const n=ids.length;const arr=[...ids];
    for(let round=0;round<n-1;round++){
      for(let i=0;i<n/2;i++)matches.push({id:`m${matchId++}`,homeTeamId:arr[i],awayTeamId:arr[n-1-i],homeScore:0,awayScore:0,played:false,round:round+1,league});
      arr.splice(1,0,arr.pop()!);
    }
    const first=matches.filter(m=>m.league===league&&m.round<=n-1);
    first.forEach(m=>matches.push({id:`m${matchId++}`,homeTeamId:m.awayTeamId,awayTeamId:m.homeTeamId,homeScore:0,awayScore:0,played:false,round:m.round+n-1,league}));
  }
  return matches;
}

export function generateInitialState():GameState{
  const teams:Team[]=ALL_TEAM_NAMES.map((name,index)=>{
    const league=Math.floor(index/10)+1;
    const repBase=league===1?65:league===2?45:25;
    return {
      id:`t${index}`,name,color:COLORS[index%COLORS.length],
      money:10_000_000/league,
      stadium:{level:1,capacity:Math.floor((20_000+rnd(0,10_000))/league),ticketPrice:Math.max(10,50-(league-1)*15),maintenanceCost:Math.floor(50_000/league)},
      finances:[],sponsorshipIncome:Math.floor((200_000+rnd(0,100_000))/league),league,
      fanSatisfaction:70,academyLevel:0,reputation:repBase+rnd(0,20),
    };
  });
  const players=teams.flatMap(t=>generatePlayersForTeam(t.id,t.league));
  return {
    teams,players,matches:generateFixtures(teams),
    currentRound:1,userTeamId:null,userLineup:[],
    formation:'4-4-2',staff:{},
    manager:{name:'Técnico',nationality:'Brasil',reputation:50,matchesManaged:0,wins:0,draws:0,losses:0,titles:0,specialization:null},
    season:1,phase:'season',lastSeasonSummary:null,
    cup:null,objectives:[],seasonHistory:[],lastMatchReport:null,pendingCupRound:null,
  };
}